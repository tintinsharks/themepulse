// SubthemeRotation.jsx
// Subtheme-level RS rotation view for ThemePulse
// Drop into ~/themepulse/src/ and wire as a tab in App.jsx
//
// Shows all subthemes ranked by RS percentile with dispersion markers
// and rotation deltas. Mirrors the Pine indicator graphic but with no
// security limit and full 168-subtheme coverage.

import React, { useEffect, useMemo, useState } from "react";

// ─── Visual scale helpers ────────────────────────────────────────────────────
const rsBarColor = (r) => {
  if (r >= 85) return "#00c853";
  if (r >= 70) return "#43a047";
  if (r >= 55) return "#7cb342";
  if (r >= 45) return "#9e9e9e";
  if (r >= 30) return "#fb8c00";
  if (r >= 15) return "#e53935";
  return "#b71c1c";
};

const deltaArrow = (d) => {
  if (d >= 10) return "▲▲";
  if (d >= 5) return "▲";
  if (d >= 2) return "△";
  if (d <= -10) return "▼▼";
  if (d <= -5) return "▼";
  if (d <= -2) return "▽";
  return "·";
};

const deltaColor = (d) => {
  // Only color truly actionable moves. Everything in the noise band stays neutral grey.
  if (d >= 8) return "#00c853";
  if (d >= 4) return "#7cb342";
  if (d <= -8) return "#e53935";
  if (d <= -4) return "#c47000";
  return "#7a7a8a";
};

const dispMarker = (d) => {
  // Tight dispersion is calm but not actionable on its own → neutral.
  // Only high dispersion (single-name carry) deserves a warning color.
  if (d == null || isNaN(d)) return { mark: "—", color: "#4a4a5a" };
  if (d <= 15) return { mark: "◆", color: "#7a7a8a" };
  if (d <= 30) return { mark: "◇", color: "#5a5a6a" };
  return { mark: "✦", color: "#fb8c00" };
};

const quadColor = (q) => {
  switch (q) {
    case "S": return "#00c853";  // Strong & Gaining
    case "I": return "#7cb342";  // Strong & Losing (improving)
    case "L": return "#fb8c00";  // Weak & Gaining (lagging recovery)
    case "W": return "#e53935";  // Weak & Losing
    default:  return "#5a5a6a";
  }
};

// ─── Data shaping ───────────────────────────────────────────────────────────

/**
 * Compute dispersion = std deviation of constituent RS within a subtheme.
 * Lower = leaders moving together (institutional flow).
 * Higher = single-name driven, lower-conviction signal.
 */
const computeDispersion = (tickers) => {
  if (!tickers || tickers.length < 2) return null;
  const vals = tickers
    .map((t) => t.rs)
    .filter((v) => v != null && !isNaN(v));
  if (vals.length < 2) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / vals.length;
  return Math.sqrt(variance);
};

/**
 * 1W rotation delta proxy: weekly RS - monthly RS.
 * If the subtheme is gaining vs the universe over the last week relative to
 * the last month, this is positive. Mirrors the Pine "1W Δ" reading.
 */
const compute1WDelta = (sub) => {
  if (sub.weekly_rs == null || sub.monthly_rs == null) return 0;
  return sub.weekly_rs - sub.monthly_rs;
};

/**
 * 4W rotation delta proxy: monthly RS - 3M return percentile.
 * For now, we approximate with monthly_rs minus a baseline of 50 (neutral).
 * If your pipeline adds a quarterly_rs field later, swap that in here.
 */
const compute4WDelta = (sub) => {
  if (sub.monthly_rs == null) return 0;
  return sub.monthly_rs - 50;
};

// ─── Constants ──────────────────────────────────────────────────────────────
const MIN_N = 3;                  // minimum tickers per subtheme to be ranked
const RVOL_UNUSUAL = 1.5;         // ticker rvol >= 1.5x = "unusual volume"
const PERSISTENCE_LOOKBACK = 5;   // days to check for top-N persistence
const TOP_N_PERSIST = 15;         // "top N" definition for persistence

// ─── Setup Score (composite signal — the headline number) ───────────────────
/**
 * Three-bucket setup score that REQUIRES all three to fire.
 * Multiplicative-style: weakest bucket caps the total. A 90/90/30 setup
 * scores worse than a 70/70/70 setup — by design.
 *
 * Buckets (each 0-100):
 *   STRENGTH    — RS rank + breadth (is it actually leading?)
 *   DIRECTION   — RS delta + persistence (is leadership growing?)
 *   CONVICTION  — dispersion + volume regime (is the move real?)
 *
 * Final score uses cube-root of product (geometric mean style) so balanced
 * setups outrank lopsided ones. Cube root of (S*D*C) / 100^2.
 *
 * Scaled to 0-100 for sortable column display.
 */

const f_clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Daily setup score — for pre-market and end-of-day reads.
 * Inputs: RS percentile, breadth, true 1D/5D delta, persistence streak, dispersion.
 */
const computeDailySetupScore = (s) => {
  if (s.rs == null) return null;

  // STRENGTH: RS rank (60%) + breadth (40%)
  const rsScore = s.rs;  // already 0-100
  const breadthScore = s.breadth ?? 50;  // null = neutral
  const strength = rsScore * 0.6 + breadthScore * 0.4;

  // DIRECTION: 1D delta normalized to 0-100 + persistence bonus
  // 1D delta of +5 RS pts = strong rotation in. Normalize ±10 to ±50 pts vs 50 baseline.
  const d1 = s.d1 ?? 0;
  const d1Score = f_clamp(50 + d1 * 5, 0, 100);
  // 5D delta — weighted half as much (already partially captured in d1)
  const d4 = s.d4 ?? 0;
  const d4Score = f_clamp(50 + d4 * 2.5, 0, 100);
  // Persistence bonus: 5d streak = +20 pts, 3d = +10 pts, NEW = +15 pts (asymmetric play),
  // FADED = -20 pts (rotation out warning), no badge = 0
  let persistAdj = 0;
  const p = s.persistence;
  if (p) {
    if (p.debut) persistAdj = 15;
    else if (p.streak >= 5) persistAdj = 20;
    else if (p.streak >= 3) persistAdj = 10;
    else if (p.days_in_top === 0 && p.first_seen) persistAdj = -20;  // FADED
  }
  const direction = f_clamp(d1Score * 0.5 + d4Score * 0.3 + 50 + persistAdj * 0.4, 0, 100);

  // CONVICTION: dispersion (lower = better) — daily dispersion is in RS percentile units
  // σ ≤15 = ◆ tight = full credit. σ ≥40 = ✦ wide = penalty.
  const disp = s.dispersion ?? 30;
  const dispScore = f_clamp(100 - disp * 2.5, 0, 100);
  // No volume signal in daily mode, so use a constant moderate value
  const conviction = dispScore;

  // Geometric mean style — cube-root of product, normalized
  // Floors any near-zero bucket so a weak bucket caps the total
  const product = strength * direction * conviction;
  const geomMean = Math.pow(product, 1 / 3);

  return {
    score: Math.round(geomMean),
    strength: Math.round(strength),
    direction: Math.round(direction),
    conviction: Math.round(conviction),
  };
};

/**
 * Live setup score — for intraday entries.
 * Inputs: live strength, today % breadth, dispersion, vol regime, persistence.
 */
const computeLiveSetupScore = (s) => {
  if (s.live_strength_score == null) return null;

  // STRENGTH: live composite (70%) + daily RS context (30%)
  // Daily RS pulled in so we don't reward intraday pops in weak-trend subthemes
  const liveStr = s.live_strength_score;
  const rs = s.rs ?? 50;
  const strength = liveStr * 0.7 + rs * 0.3;

  // DIRECTION: today % move + persistence
  const livePct = s.live_pct_med ?? 0;
  // ±5% move = ±50 pts vs 50 baseline
  const moveScore = f_clamp(50 + livePct * 10, 0, 100);
  // Live breadth bonus
  const liveBr = s.live_breadth ?? 50;
  let persistAdj = 0;
  const p = s.persistence;
  if (p) {
    if (p.debut) persistAdj = 15;
    else if (p.streak >= 5) persistAdj = 20;
    else if (p.streak >= 3) persistAdj = 10;
    else if (p.days_in_top === 0 && p.first_seen) persistAdj = -20;
  }
  const direction = f_clamp(moveScore * 0.5 + liveBr * 0.3 + 50 + persistAdj * 0.4, 0, 100);

  // CONVICTION: vol regime + dispersion
  // Vol regime mapping: EXPLOSIVE = 100, ROTATING = 75, DRIFTING = 35, QUIET = 25, null = 50
  let regimeScore = 50;
  switch (s.vol_regime) {
    case "EXPLOSIVE": regimeScore = 100; break;
    case "ROTATING":  regimeScore = 75; break;
    case "DRIFTING":  regimeScore = 35; break;
    case "QUIET":     regimeScore = 25; break;
    default:           regimeScore = 50;
  }
  // Live dispersion is in % units (typically 0.5-10). σ ≤2% = tight, σ ≥6% = wide.
  const disp = s.live_dispersion ?? 3;
  const dispScore = f_clamp(100 - disp * 12, 0, 100);
  const conviction = regimeScore * 0.6 + dispScore * 0.4;

  const product = strength * direction * conviction;
  const geomMean = Math.pow(product, 1 / 3);

  return {
    score: Math.round(geomMean),
    strength: Math.round(strength),
    direction: Math.round(direction),
    conviction: Math.round(conviction),
  };
};

/**
 * Tier classification for visual display.
 * S / A / B / C / D based on composite score thresholds.
 */
const setupTier = (score) => {
  if (score == null) return null;
  // Only the actionable tiers (S/A/B) get color. C/D fade to neutral so they
  // stop competing for attention with real setups.
  if (score >= 80) return { tier: "S", color: "#00c853", bg: "#0d2a1a", label: "TAKE" };
  if (score >= 65) return { tier: "A", color: "#7cb342", bg: "#16240e", label: "STRONG" };
  if (score >= 50) return { tier: "B", color: "#fbbf24", bg: "#241f08", label: "WAIT" };
  if (score >= 35) return { tier: "C", color: "#7a7a8a", bg: "#15151f", label: "WATCH" };
  return { tier: "D", color: "#5a5a6a", bg: "#10101a", label: "AVOID" };
};

// ─── Volume regime classification ───────────────────────────────────────────
/**
 * Classify volume conviction for a subtheme based on:
 *   - median RVol of constituents (magnitude)
 *   - % of constituents with RVol >= 1.5x (breadth of unusual volume)
 *
 * Returns one of:
 *   "EXPLOSIVE"  — broad unusual volume + high median (institutional sweep)
 *   "ROTATING"   — broad unusual volume but moderate median (steady accumulation)
 *   "DRIFTING"   — high median but narrow breadth (1-2 names carrying)
 *   "QUIET"      — neither breadth nor magnitude (no flow event)
 *   null         — insufficient data
 */
const classifyVolumeRegime = (rvolMed, rvolBreadth) => {
  if (rvolMed == null || rvolBreadth == null) return null;
  const broadVol = rvolBreadth >= 50;     // half or more constituents at unusual vol
  const highMed = rvolMed >= 1.5;
  if (broadVol && highMed) return "EXPLOSIVE";
  if (broadVol && !highMed) return "ROTATING";
  if (!broadVol && highMed) return "DRIFTING";
  return "QUIET";
};

const volRegimeStyle = (regime) => {
  switch (regime) {
    case "EXPLOSIVE": return { color: "#00c853", bg: "#0d2a1a", label: "EXPLOSIVE", icon: "⚡" };
    case "ROTATING":  return { color: "#7cb342", bg: "#16240e", label: "ROTATING",  icon: "↻" };
    case "DRIFTING":  return { color: "#fb8c00", bg: "#241608", label: "DRIFTING",  icon: "~" };
    case "QUIET":     return { color: "#5a5a6a", bg: "#141420", label: "QUIET",     icon: "·" };
    default:          return { color: "#5a5a6a", bg: "#141420", label: "—",         icon: "·" };
  }
};

// ─── Persistence (rotation memory) ──────────────────────────────────────────
/**
 * Build a persistence map keyed by `${parent}|${name}` from the history file.
 *
 * For each subtheme, compute:
 *   - days_in_top: number of last N days the subtheme was in top TOP_N_PERSIST
 *   - rs_5d_change: today's RS minus RS 5 days ago (true rotation delta)
 *   - rs_1d_change: today's RS minus yesterday's RS (overnight repositioning)
 *   - first_seen: first date we have data for this subtheme
 *   - debut: true if today is the first day this subtheme entered top-N
 *
 * This is computed once (memoized) when history loads, then looked up
 * O(1) per subtheme during rendering.
 */
const buildPersistenceMap = (history, todaysSubthemes) => {
  if (!history?.days || history.days.length === 0) return {};

  const days = history.days;
  const today = days[days.length - 1];
  const todayDate = today?.date;

  // Build per-day top-N sets for fast membership checks
  const topNSets = days.slice(-PERSISTENCE_LOOKBACK).map((day) => {
    const ranked = [...(day.subthemes || [])].sort((a, b) => (b.rs ?? 0) - (a.rs ?? 0));
    const topNames = new Set(
      ranked.slice(0, TOP_N_PERSIST).map((s) => `${s.parent}|${s.name}`)
    );
    return { date: day.date, topNames, all: day.subthemes || [] };
  });

  // Yesterday and 5d-ago lookup tables for delta calc
  const lookupByDate = {};
  days.forEach((day) => {
    const m = {};
    (day.subthemes || []).forEach((s) => {
      m[`${s.parent}|${s.name}`] = s;
    });
    lookupByDate[day.date] = m;
  });

  const ydayDate = days.length >= 2 ? days[days.length - 2].date : null;
  const fiveDayDate = days.length >= 6 ? days[days.length - 6].date : null;

  const out = {};
  todaysSubthemes.forEach((sub) => {
    const key = `${sub.parent}|${sub.name}`;

    // Count how many of the last N days this subtheme was in top-N
    const daysInTop = topNSets.filter((d) => d.topNames.has(key)).length;

    // True 1d and 5d RS deltas (replaces the proxy weekly_rs - monthly_rs)
    const todayEntry = lookupByDate[todayDate]?.[key];
    const ydayEntry = ydayDate ? lookupByDate[ydayDate]?.[key] : null;
    const fiveDayEntry = fiveDayDate ? lookupByDate[fiveDayDate]?.[key] : null;

    const rs1dChange = (todayEntry?.rs != null && ydayEntry?.rs != null)
      ? todayEntry.rs - ydayEntry.rs : null;
    const rs5dChange = (todayEntry?.rs != null && fiveDayEntry?.rs != null)
      ? todayEntry.rs - fiveDayEntry.rs : null;

    // First-seen detection
    let firstSeen = null;
    for (const day of days) {
      const found = (day.subthemes || []).some((s) =>
        `${s.parent}|${s.name}` === key
      );
      if (found) { firstSeen = day.date; break; }
    }

    // Debut = today is the first day this is in top-N
    const inTopToday = topNSets[topNSets.length - 1]?.topNames.has(key) ?? false;
    const wasInTopBefore = topNSets.slice(0, -1).some((d) => d.topNames.has(key));
    const debut = inTopToday && !wasInTopBefore;

    // Streak — how many consecutive days from today this subtheme was in top-N
    let streak = 0;
    for (let i = topNSets.length - 1; i >= 0; i--) {
      if (topNSets[i].topNames.has(key)) streak++;
      else break;
    }

    // New-leader detection: today is in LEADING quadrant (rs ≥ 50 AND velocity ≥ 0)
    // but yesterday was not. Velocity = weekly_rs - monthly_rs.
    const inLeading = (entry) => {
      if (!entry || entry.rs == null) return false;
      const rsOk = entry.rs >= 50;
      const wk = entry.weekly_rs ?? entry.rs;
      const mo = entry.monthly_rs ?? entry.rs;
      const velOk = (wk - mo) >= 0;
      return rsOk && velOk;
    };
    const newLeader = !!(todayEntry && ydayEntry && inLeading(todayEntry) && !inLeading(ydayEntry));

    out[key] = {
      days_in_top: daysInTop,
      streak,
      debut,
      new_leader: newLeader,
      rs_1d_change: rs1dChange,
      rs_5d_change: rs5dChange,
      first_seen: firstSeen,
      lookback: PERSISTENCE_LOOKBACK,
    };
  });

  return out;
};

// Visual badge for persistence
const persistenceBadge = (persist) => {
  if (!persist) return null;
  const { days_in_top, streak, debut, lookback } = persist;
  if (debut) return { label: "NEW", color: "#00c853", bg: "#0d2a1a", title: "Debut in top-N today" };
  if (streak >= lookback) return { label: `${streak}d`, color: "#00c853", bg: "#0d2a1a",
                                    title: `Top-N for ${streak} consecutive days — persistent leader` };
  if (streak >= 3) return { label: `${streak}d`, color: "#7cb342", bg: "#16240e",
                            title: `${streak}-day streak in top-N` };
  if (days_in_top >= 3) return { label: `${days_in_top}/${lookback}`, color: "#fbbf24", bg: "#241f08",
                                  title: `In top-N ${days_in_top} of last ${lookback} days (intermittent)` };
  if (days_in_top >= 1) return { label: "FADED", color: "#fb8c00", bg: "#241608",
                                  title: "In top-N earlier this week but not today" };
  return null;
};

// ─── Live (intraday) aggregation ────────────────────────────────────────────
/**
 * Compute live subtheme aggregates from constituent tickers.
 * Used in "Today" mode for intraday rotation reads.
 *
 * Returns:
 *   live_pct_med: median of constituent live_pct (intraday % change)
 *   live_pct_mean: mean (sensitive to outliers, used for skew detection)
 *   live_breadth: pct of constituents with live_pct > 0
 *   live_rvol_med: median rvol across constituents (volume conviction)
 *   live_dispersion: std-dev of live_pct values (synchronized vs single-name)
 *   live_strength_score: composite 0-100 score for ranking
 */
const computeLiveAggregates = (tickers, liveQuotes = null) => {
  if (!tickers || tickers.length === 0) {
    return { live_pct_med: null, live_breadth: null, live_rvol_med: null,
             live_rvol_breadth: null, live_dispersion: null, live_strength_score: null,
             vol_regime: null };
  }

  // Per-ticker resolver — prefer fresh quote from /api/live, fall back to pipeline snapshot
  const resolvePct = (t) => {
    const tk = typeof t === "string" ? t : t?.ticker;
    const live = tk && liveQuotes ? liveQuotes[tk] : null;
    if (live?.change != null && !isNaN(live.change)) return live.change;
    const v = t.live_pct ?? t.chg ?? null;
    return v != null && !isNaN(v) ? v : null;
  };
  const resolveRvol = (t) => {
    const tk = typeof t === "string" ? t : t?.ticker;
    const live = tk && liveQuotes ? liveQuotes[tk] : null;
    if (live?.volume && live?.avgVolume && live.avgVolume > 0) {
      const r = live.volume / live.avgVolume;
      if (!isNaN(r)) return r;
    }
    const v = t.rvol ?? null;
    return v != null && !isNaN(v) ? v : null;
  };

  // Closing range %: where in today's high-low range is the current price?
  // Only computable from /api/live (needs dayHigh / dayLow / price).
  // 100 = closing at day's high, 0 = closing at day's low.
  const resolveCrp = (t) => {
    const tk = typeof t === "string" ? t : t?.ticker;
    const live = tk && liveQuotes ? liveQuotes[tk] : null;
    if (!live) return null;
    const { price, dayHigh, dayLow } = live;
    if (price == null || dayHigh == null || dayLow == null) return null;
    const range = dayHigh - dayLow;
    if (range <= 0) return null;
    return Math.max(0, Math.min(100, ((price - dayLow) / range) * 100));
  };

  const livePcts = tickers.map(resolvePct).filter((v) => v != null);
  const rvols = tickers.map(resolveRvol).filter((v) => v != null);
  const crps = tickers.map(resolveCrp).filter((v) => v != null);

  // Aggregate RVol is available even without live pct data (pipeline field)
  const rvolAggEarly = rvols.length > 0
    ? rvols.reduce((a, b) => a + b, 0) / rvols.length
    : null;

  if (livePcts.length < 2) {
    return { live_pct_med: null, live_breadth: null, live_rvol_med: null,
             live_rvol_breadth: null, live_crp_med: null, live_dispersion: null, live_strength_score: null,
             vol_regime: null, rvol_agg: rvolAggEarly };
  }

  const sorted = [...livePcts].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const mean = livePcts.reduce((a, b) => a + b, 0) / livePcts.length;
  const variance = livePcts.reduce((acc, v) => acc + (v - mean) ** 2, 0) / livePcts.length;
  const dispersion = Math.sqrt(variance);
  const breadth = (livePcts.filter((v) => v > 0).length / livePcts.length) * 100;

  // Volume aggregates
  const rvolMed = rvols.length > 0
    ? [...rvols].sort((a, b) => a - b)[Math.floor(rvols.length / 2)]
    : null;
  const rvolBreadth = rvols.length > 0
    ? (rvols.filter((v) => v >= RVOL_UNUSUAL).length / rvols.length) * 100
    : null;
  const volRegime = classifyVolumeRegime(rvolMed, rvolBreadth);

  // Aggregate RVol: mean of individual rvols, normalized by N.
  // This is equivalent to sum(vol)/sum(avg_vol) when all avg_vols are equal,
  // and degrades gracefully when only some tickers have rvol data.
  const rvolAgg = rvols.length > 0
    ? rvols.reduce((a, b) => a + b, 0) / rvols.length
    : null;

  // Composite strength: combines move size, breadth, and volume confirmation
  const moveScore = Math.max(0, Math.min(100, 50 + med * 10));   // ±5% move = ±50 pts
  const breadthScore = breadth;                                    // already 0-100
  const volScore = rvolMed != null ? Math.min(100, rvolMed * 50) : 50; // 1.0x rvol = 50
  const strength = moveScore * 0.5 + breadthScore * 0.3 + volScore * 0.2;

  // Closing range median across constituents (when live quotes are present)
  const crpMed = crps.length > 0
    ? [...crps].sort((a, b) => a - b)[Math.floor(crps.length / 2)]
    : null;

  return {
    live_pct_med: med,
    live_pct_mean: mean,
    live_breadth: breadth,
    live_rvol_med: rvolMed,
    live_rvol_breadth: rvolBreadth,
    live_crp_med: crpMed,
    live_dispersion: dispersion,
    live_strength_score: strength,
    vol_regime: volRegime,
    rvol_agg: rvolAgg,
  };
};

// ─── Main component ─────────────────────────────────────────────────────────
export default function SubthemeRotation({ data, history, liveQuotes = null, portfolio = [], watchlist = [], onTickerClick }) {
  const portfolioSet = useMemo(() => new Set((portfolio || []).map((t) => String(t).toUpperCase())), [portfolio]);
  const watchlistSet = useMemo(() => new Set((watchlist || []).map((t) => String(t).toUpperCase())), [watchlist]);
  const [viewMode, setViewMode] = useState("grouped"); // "scatter" | "flat" | "grouped"
  const [timeframe, setTimeframe] = useState("live"); // "daily" | "live"
  const [filterParent, setFilterParent] = useState("ALL");
  const [sortBy, setSortBy] = useState("rs");
  const [sortDir, setSortDir] = useState("desc");
  const onSort = (key) => {
    setSortBy((prev) => {
      if (prev === key) { setSortDir((d) => d === "desc" ? "asc" : "desc"); return key; }
      setSortDir("desc");
      return key;
    });
  };
  const [showLowN, setShowLowN] = useState(false);
  const [topN, setTopN] = useState(168);             // limit flat view rows
  const [showTickers, setShowTickers] = useState(true); // grouped view: name vs ticker chips

  // ─── Pull all subthemes from dashboard_data.json ─────────────────────────
  const allSubthemes = useMemo(() => {
    if (!data?.themes) return [];
    const out = [];
    data.themes.forEach((theme) => {
      (theme.subthemes || []).forEach((sub) => {
        const tickers = sub.tickers || [];
        const dispersion = computeDispersion(tickers);
        const live = computeLiveAggregates(tickers, liveQuotes);
        const rs = sub.weekly_rs ?? sub.rs ?? null;
        out.push({
          name: sub.name,
          parent: theme.name,
          parent_color: theme.color,
          n: tickers.length,
          rs: rs,
          weekly_rs: sub.weekly_rs ?? null,
          monthly_rs: sub.monthly_rs ?? null,
          breadth: sub.breadth ?? null,
          a_grades: sub.a_grades ?? 0,
          return_1w: sub.return_1w ?? null,
          return_1m: sub.return_1m ?? null,
          return_3m: sub.return_3m ?? null,
          quad: sub.quad ?? null,
          d1: compute1WDelta(sub),
          d4: compute4WDelta(sub),
          dispersion,
          // Live intraday aggregates (includes vol_regime)
          ...live,
          tickers,
        });
      });
    });
    return out;
  }, [data, liveQuotes]);

  // ─── Build persistence map from history (memoized) ───────────────────────
  const persistenceMap = useMemo(() => {
    if (!history) return {};
    return buildPersistenceMap(history, allSubthemes);
  }, [history, allSubthemes]);

  // SPY's live move — used to compute each theme's relative strength today.
  // Falls back to null when SPY isn't in liveQuotes yet.
  const spyPct = useMemo(() => {
    const q = liveQuotes?.SPY;
    return q?.change != null && !isNaN(q.change) ? q.change : null;
  }, [liveQuotes]);

  // ─── Attach persistence + true deltas + setup score to each subtheme ────
  const enrichedSubthemes = useMemo(() => {
    return allSubthemes.map((s) => {
      const p = persistenceMap[`${s.parent}|${s.name}`] || null;
      // Use true RS delta when available, fall back to proxy
      const trueD1 = p?.rs_1d_change ?? null;
      const trueD5 = p?.rs_5d_change ?? null;
      const enriched = {
        ...s,
        persistence: p,
        d1: trueD1 != null ? trueD1 : s.d1,
        d1_label: trueD1 != null ? "1D Δ" : "1W Δ",
        d4: trueD5 != null ? trueD5 : s.d4,
        d4_label: trueD5 != null ? "5D Δ" : "4W Δ",
        live_pct_rel_spy: (spyPct != null && s.live_pct_med != null)
          ? s.live_pct_med - spyPct : null,
      };
      // Compute setup scores AFTER enrichment (need persistence + true deltas)
      enriched.daily_setup = computeDailySetupScore(enriched);
      enriched.live_setup = computeLiveSetupScore(enriched);
      return enriched;
    });
  }, [allSubthemes, persistenceMap, spyPct]);

  // ─── Parent theme list for filter ────────────────────────────────────────
  const parentThemes = useMemo(() => {
    const set = new Set(enrichedSubthemes.map((s) => s.parent));
    return ["ALL", ...Array.from(set).sort()];
  }, [enrichedSubthemes]);

  // ─── Apply filters + sort ────────────────────────────────────────────────
  const visible = useMemo(() => {
    let rows = enrichedSubthemes;
    if (!showLowN) rows = rows.filter((s) => s.n >= MIN_N);
    if (filterParent !== "ALL") rows = rows.filter((s) => s.parent === filterParent);

    // In live mode, require live data; in daily mode, require RS
    if (timeframe === "live") {
      rows = rows.filter((s) => s.live_strength_score != null);
    } else {
      rows = rows.filter((s) => s.rs != null);
    }

    const sorters = {
      rs:           (a, b) => (b.rs ?? 0) - (a.rs ?? 0),
      d1:           (a, b) => (b.d1 ?? 0) - (a.d1 ?? 0),
      d4:           (a, b) => (b.d4 ?? 0) - (a.d4 ?? 0),
      live_strength:(a, b) => (b.live_strength_score ?? 0) - (a.live_strength_score ?? 0),
      live_pct:     (a, b) => (b.live_pct_med ?? -999) - (a.live_pct_med ?? -999),
      rel_spy:      (a, b) => (b.live_pct_rel_spy ?? -999) - (a.live_pct_rel_spy ?? -999),
      new_leader:   (a, b) => {
        const aN = a.persistence?.new_leader ? 1 : 0;
        const bN = b.persistence?.new_leader ? 1 : 0;
        if (aN !== bN) return bN - aN;
        // Within new-leader group, sort by today % then setup
        return ((b.live_pct_med ?? -999) - (a.live_pct_med ?? -999))
            || ((b.live_setup?.score ?? 0) - (a.live_setup?.score ?? 0));
      },
      live_breadth: (a, b) => (b.live_breadth ?? 0) - (a.live_breadth ?? 0),
      rvol_agg:     (a, b) => (b.rvol_agg ?? 0) - (a.rvol_agg ?? 0),
      streak:       (a, b) => (b.persistence?.streak ?? 0) - (a.persistence?.streak ?? 0),
      vol_breadth:  (a, b) => (b.live_rvol_breadth ?? 0) - (a.live_rvol_breadth ?? 0),
      crp_med:      (a, b) => (b.live_crp_med ?? -1) - (a.live_crp_med ?? -1),
      n:            (a, b) => (b.n ?? 0) - (a.n ?? 0),
      setup: (a, b) => {
        const aScore = (timeframe === "live" ? a.live_setup : a.daily_setup)?.score ?? 0;
        const bScore = (timeframe === "live" ? b.live_setup : b.daily_setup)?.score ?? 0;
        return bScore - aScore;
      },
    };

    const effectiveSort = timeframe === "live" && sortBy === "rs" ? "live_strength" : sortBy;
    const sorter = sorters[effectiveSort] || sorters.rs;
    rows = [...rows].sort(sortDir === "asc" ? (a, b) => sorter(b, a) : sorter);
    return rows;
  }, [enrichedSubthemes, showLowN, filterParent, sortBy, sortDir, timeframe]);

  // ─── Breadth regime read across visible set ──────────────────────────────
  const regime = useMemo(() => {
    if (!visible.length) return { label: "—", color: "#5a5a6a", inCount: 0, outCount: 0 };

    if (timeframe === "live") {
      // Live regime: based on subtheme-level live strength score
      const inCount = visible.filter((s) => (s.live_strength_score ?? 50) > 65).length;
      const outCount = visible.filter((s) => (s.live_strength_score ?? 50) < 35).length;
      const ratio = inCount / visible.length;
      if (ratio >= 0.4) return { label: "🟢 BROAD INTRADAY STRENGTH", color: "#00c853", inCount, outCount };
      if (outCount / visible.length >= 0.4) return { label: "🔴 BROAD INTRADAY WEAKNESS", color: "#e53935", inCount, outCount };
      if (inCount >= 5) return { label: "🟡 SELECTIVE INTRADAY MOVES", color: "#fbbf24", inCount, outCount };
      return { label: "⚪ MIXED INTRADAY / LOW VOL", color: "#9090a0", inCount, outCount };
    }

    // Daily regime: based on 1W rotation deltas (existing logic)
    const inCount = visible.filter((s) => s.d1 > 5).length;
    const outCount = visible.filter((s) => s.d1 < -5).length;
    const ratio = inCount / visible.length;
    if (ratio >= 0.4) return { label: "🟢 BROAD ROTATION IN", color: "#00c853", inCount, outCount };
    if (outCount / visible.length >= 0.4) return { label: "🔴 BROAD ROTATION OUT", color: "#e53935", inCount, outCount };
    if (inCount >= 5) return { label: "🟡 SELECTIVE STRENGTH", color: "#fbbf24", inCount, outCount };
    return { label: "⚪ MIXED / RANGE", color: "#9090a0", inCount, outCount };
  }, [visible, timeframe]);

  // ─── Display rows (apply topN cap) ───────────────────────────────────────
  const displayRows = useMemo(() => {
    if (viewMode === "grouped") return visible;
    return visible.slice(0, topN);
  }, [visible, viewMode, topN]);

  // ─── Group by parent for "grouped" view ──────────────────────────────────
  // `visible` is already sorted by the user-selected sortBy/sortDir, so we
  // preserve that order within each parent group. Parent groups themselves
  // are ordered by the position of their first (best-ranked) subtheme so
  // the active sort key drives both axes.
  const grouped = useMemo(() => {
    if (viewMode !== "grouped") return [];
    const groups = new Map();
    const firstIdx = new Map();
    visible.forEach((s, i) => {
      if (!groups.has(s.parent)) {
        groups.set(s.parent, []);
        firstIdx.set(s.parent, i);
      }
      groups.get(s.parent).push(s);
    });
    const strengthOf = (s) =>
      timeframe === "live" ? (s.live_strength_score ?? s.rs ?? 0) : (s.rs ?? 0);
    const arr = Array.from(groups.entries()).map(([parent, subs]) => ({
      parent,
      subs,
      maxRS: strengthOf(subs[0] ?? {}),
      color: subs[0]?.parent_color,
      _firstIdx: firstIdx.get(parent),
    }));
    arr.sort((a, b) => a._firstIdx - b._firstIdx);
    return arr;
  }, [visible, viewMode, timeframe]);

  return (
    <div style={{ padding: 16, color: "#e0e0e8", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* ─── Header + controls ─────────────────────────────────────────── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>
          Subtheme Rotation
        </div>
        <span style={{ fontSize: 11, color: "#7a7a8a" }}>
          {visible.length} subthemes · N≥{MIN_N}
        </span>

        {/* Daily / Live timeframe toggle — the headline intraday switch */}
        <div style={{ display: "flex", gap: 0, marginLeft: 8, border: "1px solid #2a2a40", borderRadius: 4, overflow: "hidden" }}>
          {[
            { id: "daily", label: "Daily RS", desc: "Mansfield weekly/monthly" },
            { id: "live", label: "● Today", desc: "Live intraday strength" },
          ].map((tf) => (
            <button
              key={tf.id}
              onClick={() => setTimeframe(tf.id)}
              title={tf.desc}
              style={{
                padding: "5px 12px",
                fontSize: 11,
                background: timeframe === tf.id ? (tf.id === "live" ? "#0d2a1a" : "#2a2a40") : "#141420",
                color: timeframe === tf.id ? (tf.id === "live" ? "#00c853" : "#fff") : "#9090a0",
                border: "none",
                cursor: "pointer",
                fontWeight: timeframe === tf.id ? 700 : 400,
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              {tf.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
          {[
            { id: "scatter", label: "◉ Scatter" },
            { id: "flat",    label: "≡ Table" },
            { id: "grouped", label: "⊞ Grouped" },
          ].map((mode) => (
            <button
              key={mode.id}
              onClick={() => setViewMode(mode.id)}
              style={{
                padding: "4px 10px",
                fontSize: 11,
                background: viewMode === mode.id ? "#2a2a40" : "#141420",
                color: viewMode === mode.id ? "#fff" : "#9090a0",
                border: "1px solid #222230",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              {mode.label}
            </button>
          ))}
        </div>

        <select
          value={filterParent}
          onChange={(e) => setFilterParent(e.target.value)}
          style={{
            padding: "4px 8px", fontSize: 11, background: "#141420",
            color: "#e0e0e8", border: "1px solid #222230", borderRadius: 4,
          }}
        >
          {parentThemes.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          style={{
            padding: "4px 8px", fontSize: 11, background: "#141420",
            color: "#e0e0e8", border: "1px solid #222230", borderRadius: 4,
          }}
        >
          {timeframe === "live" ? (
            <>
              <option value="setup">Sort: Setup Score ⭐</option>
              <option value="new_leader">Sort: New Leaders ★</option>
              <option value="rs">Sort: Live Strength</option>
              <option value="live_pct">Sort: Today %</option>
              <option value="rel_spy">Sort: vs SPY</option>
              <option value="live_breadth">Sort: Live Breadth</option>
              <option value="crp_med">Sort: Closing Range %</option>
              <option value="vol_breadth">Sort: Vol Breadth</option>
              <option value="streak">Sort: Persistence</option>
              <option value="rs">Sort: Daily RS</option>
            </>
          ) : (
            <>
              <option value="setup">Sort: Setup Score ⭐</option>
              <option value="rs">Sort: RS</option>
              <option value="d1">Sort: 1D/1W Δ</option>
              <option value="d4">Sort: 5D/4W Δ</option>
              <option value="breadth">Sort: Breadth</option>
              <option value="streak">Sort: Persistence</option>
            </>
          )}
        </select>

        <label style={{ fontSize: 11, color: "#9090a0", display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showLowN}
            onChange={(e) => setShowLowN(e.target.checked)}
          />
          Show N&lt;{MIN_N}
        </label>

        {(viewMode === "flat" || viewMode === "scatter") && (
          <select
            value={topN}
            onChange={(e) => setTopN(Number(e.target.value))}
            style={{
              padding: "4px 8px", fontSize: 11, background: "#141420",
              color: "#e0e0e8", border: "1px solid #222230", borderRadius: 4,
            }}
          >
            {[15, 30, 50, 100, 168].map((n) => (
              <option key={n} value={n}>Top {n}</option>
            ))}
          </select>
        )}
      </div>

      {/* ─── Scatter view ──────────────────────────────────────────────── */}
      {viewMode === "scatter" && (
        <ScatterPlot
          rows={displayRows}
          timeframe={timeframe}
          onTickerClick={onTickerClick}
        />
      )}

      {/* ─── Flat view ─────────────────────────────────────────────────── */}
      {viewMode === "flat" && (
        <SubthemeTable
          rows={displayRows}
          onTickerClick={onTickerClick}
          timeframe={timeframe}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={onSort}
          portfolioSet={portfolioSet}
          watchlistSet={watchlistSet}
          liveQuotes={liveQuotes}
        />
      )}

      {/* ─── Grouped view ──────────────────────────────────────────────── */}
      {viewMode === "grouped" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: -10 }}>
            <button
              onClick={() => setShowTickers((v) => !v)}
              style={{
                padding: "4px 10px", fontSize: 11,
                background: showTickers ? "#1c2238" : "#141420",
                color: showTickers ? "#fff" : "#9090a0",
                border: `1px solid ${showTickers ? "#3a4a7a" : "#222230"}`,
                borderRadius: 4, cursor: "pointer",
              }}
              title="Toggle first column between subtheme names and individual ticker chips"
            >
              {showTickers ? "▣ Tickers" : "▢ Tickers"}
            </button>
          </div>
          {grouped.map((g) => (
            <div key={g.parent}>
              <div style={{
                display: "flex", alignItems: "center", gap: 8, marginBottom: 6,
                paddingBottom: 4, borderBottom: `1px solid ${g.color || "#222230"}40`,
              }}>
                <span style={{ width: 10, height: 10, background: g.color || "#5a5a6a", borderRadius: 2, display: "inline-block" }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{g.parent}</span>
                <span style={{ fontSize: 10, color: "#7a7a8a" }}>
                  {g.subs.length} subthemes · top RS {g.maxRS?.toFixed(0)}
                </span>
              </div>
              <SubthemeTable rows={g.subs} onTickerClick={onTickerClick} timeframe={timeframe} showTickers={showTickers} portfolioSet={portfolioSet} watchlistSet={watchlistSet} liveQuotes={liveQuotes} />
            </div>
          ))}
        </div>
      )}

      {/* ─── Legend ────────────────────────────────────────────────────── */}
      <div style={{
        marginTop: 16, padding: "8px 12px", background: "#0d0d1a",
        border: "1px solid #222230", borderRadius: 6, fontSize: 10,
        color: "#7a7a8a", display: "flex", flexWrap: "wrap", gap: 16,
      }}>
        <span><span style={{ color: "#00c853" }}>▲▲</span> ≥+10 · <span style={{ color: "#00c853" }}>▲</span> ≥+5 · <span style={{ color: "#7cb342" }}>△</span> ≥+2</span>
        <span>Bar = RS rank · Color = strength tier</span>
        <span><span style={{ color: "#00c853" }}>◆</span> tight (≤15) · <span style={{ color: "#9e9e9e" }}>◇</span> mid · <span style={{ color: "#fb8c00" }}>✦</span> wide (&gt;30)</span>
        <span>1W Δ = weekly RS − monthly RS · 4W Δ = monthly RS − 50</span>
        <span style={{ color: "#00c853", fontWeight: 700 }}>🎯 Best setup: top RS + ▲ + ◆</span>
      </div>
    </div>
  );
}

// ─── Scatter: RS vs RS-Velocity bubble chart ────────────────────────────────
// X = RS percentile (where is this theme ranked right now?)
// Y = RS velocity = weekly_rs - monthly_rs (is it accelerating or decelerating?)
// Y=0 dividing line: above = momentum building, below = fading
// Color = RVol (volume confirmation) — green = high, amber = normal
// Size = N (breadth of theme confirmation)
// Quadrants: LEADING (strong+accel) · ROTATING IN (weak+accel) · FADING (strong+decel) · LAGGING
function ScatterPlot({ rows, timeframe, onTickerClick }) {
  const [hovered, setHovered] = useState(null);
  const [selected, setSelected] = useState(null);
  const [hoverParent, setHoverParent] = useState(null);
  const [filterParent, setFilterParent] = useState(null);
  // For muting bubbles in the scatter — only on hover, not when filtering
  // (when filtering, the rows array is already reduced so muting is unnecessary)
  const highlightParent = filterParent ? null : hoverParent;
  const isLive = timeframe === "live";

  const W = 820, H = 520;
  const PAD = { top: 36, right: 32, bottom: 52, left: 58 };
  const PW = W - PAD.left - PAD.right;
  const PH = H - PAD.top - PAD.bottom;

  // X: RS percentile (0-100)
  const xVal = (r) => isLive ? (r.live_strength_score ?? r.rs ?? 0) : (r.rs ?? 0);

  // Y: RS velocity = weekly_rs - monthly_rs, clamped to [-60, 60], mapped to [0,100]
  const rawVel = (r) => (r.weekly_rs ?? r.rs ?? 50) - (r.monthly_rs ?? r.rs ?? 50);
  const VEL_RANGE = 60; // ±60 covers ~99% of cases
  const yVal = (r) => {
    const v = rawVel(r);
    return Math.max(0, Math.min(100, ((v + VEL_RANGE) / (2 * VEL_RANGE)) * 100));
  };
  const yZero = PAD.top + PH - (((0 + VEL_RANGE) / (2 * VEL_RANGE)) * PH); // pixel y for velocity=0

  // Map to SVG coords
  const toX = (v) => PAD.left + (v / 100) * PW;
  const toY = (v) => PAD.top + PH - (v / 100) * PH;

  // Y-axis tick labels in real velocity units
  const yTicks = [-50, -25, 0, 25, 50].map((v) => ({
    v, label: v === 0 ? "0" : (v > 0 ? `+${v}` : `${v}`),
    py: PAD.top + PH - (((v + VEL_RANGE) / (2 * VEL_RANGE)) * PH),
  }));

  const toR = () => 8;

  // When a parent is locked via click, the scatter only shows that parent's subthemes.
  const displayRows = filterParent ? rows.filter((r) => r.parent === filterParent) : rows;

  // Color by today's % percentile rank across all visible subthemes.
  // Percentile-based so the full green→red range always renders regardless
  // of whether the market is up 3% or down 3%.
  const chgValues = displayRows
    .map((r) => isLive ? r.live_pct_med : r.d1)
    .filter((v) => v != null)
    .sort((a, b) => a - b);
  const chgPct = (r) => {
    const v = isLive ? r.live_pct_med : r.d1;
    if (v == null || chgValues.length === 0) return null;
    const rank = chgValues.filter((x) => x <= v).length;
    return rank / chgValues.length; // 0 = worst, 1 = best
  };
  const bubbleFill = (r) => {
    const p = chgPct(r);
    if (p == null) return "#5a5a7a";
    if (p >= 0.85) return "#00e676";
    if (p >= 0.65) return "#69f0ae";
    if (p >= 0.45) return "#a8c8a8";
    if (p >= 0.35) return "#c8a8a8";
    if (p >= 0.15) return "#e53935";
    return "#b71c1c";
  };

  // Border = setup tier
  const strokeCol = (r) => {
    const s = isLive ? r.live_setup : r.daily_setup;
    if (!s) return "#3a3a55";
    const t = setupTier(s.score);
    return t ? t.color : "#3a3a55";
  };

  const setupScore = (r) => (isLive ? r.live_setup : r.daily_setup)?.score ?? 0;

  // Top 30 by setup score are fully visible; rest are faint grey dots.
  // When a parent is hover-highlighted, all its subthemes become visible (overrides top 30).
  // When filtered, every bubble in displayRows is fully visible.
  const TOP_VISIBLE = 30;
  const sortedByScore = [...displayRows].sort((a, b) => setupScore(b) - setupScore(a));
  const visibleSet = new Set(sortedByScore.slice(0, TOP_VISIBLE).map((r) => `${r.parent}|${r.name}`));
  const isVisible = (r) => {
    if (filterParent) return true;
    if (highlightParent) return r.parent === highlightParent;
    return visibleSet.has(`${r.parent}|${r.name}`);
  };
  const isMuted = (r) => highlightParent != null && r.parent !== highlightParent;

  // Parent legend: aggregate subthemes by parent, sorted by count desc
  const parentStats = (() => {
    const map = new Map();
    rows.forEach((r) => {
      if (!r.parent) return;
      const cur = map.get(r.parent) || { name: r.parent, n: 0, avgSetup: 0, leading: 0 };
      cur.n += 1;
      cur.avgSetup += setupScore(r);
      // "Leading" = RS >= 50 AND velocity >= 0
      if ((r.rs ?? 0) >= 50 && rawVel(r) >= 0) cur.leading += 1;
      map.set(r.parent, cur);
    });
    return [...map.values()]
      .map((p) => ({ ...p, avgSetup: p.n ? Math.round(p.avgSetup / p.n) : 0 }))
      .sort((a, b) => b.avgSetup - a.avgSetup || b.n - a.n);
  })();

  const handleBubble = (r) => setSelected((prev) => prev?.name === r.name ? null : r);

  // Draw faint bubbles first, then visible ones on top
  const sorted = [...displayRows].sort((a, b) => {
    const aVis = isVisible(a) ? 1 : 0;
    const bVis = isVisible(b) ? 1 : 0;
    if (aVis !== bVis) return aVis - bVis;
    return setupScore(a) - setupScore(b);
  });

  return (
    <div style={{ background: "#111122", border: "1px solid #2a2a40", borderRadius: 6, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "stretch" }}>
      <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
          {/* Plot background */}
          <rect x={PAD.left} y={PAD.top} width={PW} height={PH} fill="#0c0c1c" />

          {/* Quadrant zones — split at RS=50 (x) and velocity=0 (y) */}
          <rect x={PAD.left}       y={PAD.top}       width={PW/2} height={yZero - PAD.top}  fill="#0d1f10" opacity={0.85} />
          <rect x={PAD.left+PW/2}  y={PAD.top}       width={PW/2} height={yZero - PAD.top}  fill="#0a2810" opacity={0.9}  />
          <rect x={PAD.left}       y={yZero}          width={PW/2} height={PAD.top+PH-yZero} fill="#111111" opacity={0.5}  />
          <rect x={PAD.left+PW/2}  y={yZero}          width={PW/2} height={PAD.top+PH-yZero} fill="#200d0d" opacity={0.75} />

          {/* X grid lines */}
          {[25, 50, 75].map((v) => (
            <line key={v} x1={toX(v)} y1={PAD.top} x2={toX(v)} y2={PAD.top+PH}
                  stroke={v===50 ? "#3a3a5e" : "#1e1e34"} strokeWidth={v===50 ? 1.5 : 1} strokeDasharray={v===50 ? "6,4" : "3,6"} />
          ))}

          {/* Y grid lines at velocity ticks */}
          {yTicks.map(({ v, py }) => (
            <line key={v} x1={PAD.left} y1={py} x2={PAD.left+PW} y2={py}
                  stroke={v===0 ? "#4a4a6e" : "#1e1e34"} strokeWidth={v===0 ? 2 : 1} strokeDasharray={v===0 ? "none" : "3,6"} />
          ))}

          {/* Quadrant labels */}
          <text x={toX(25)} y={PAD.top+18} fill="#236023" fontSize={11} textAnchor="middle" fontWeight={800} letterSpacing={1}>ROTATING IN ↗</text>
          <text x={toX(75)} y={PAD.top+18} fill="#237a23" fontSize={11} textAnchor="middle" fontWeight={800} letterSpacing={1}>LEADING ★</text>
          <text x={toX(25)} y={PAD.top+PH-10} fill="#2a2a50" fontSize={11} textAnchor="middle" fontWeight={800} letterSpacing={1}>LAGGING</text>
          <text x={toX(75)} y={PAD.top+PH-10} fill="#5a2020" fontSize={11} textAnchor="middle" fontWeight={800} letterSpacing={1}>FADING ↘</text>

          {/* X-axis ticks */}
          {[0, 25, 50, 75, 100].map((v) => (
            <g key={v}>
              <line x1={toX(v)} y1={PAD.top+PH} x2={toX(v)} y2={PAD.top+PH+5} stroke="#4a4a60" strokeWidth={1} />
              <text x={toX(v)} y={PAD.top+PH+17} fill="#8a8aaa" fontSize={9} textAnchor="middle">{v}</text>
            </g>
          ))}

          {/* Y-axis ticks */}
          {yTicks.map(({ label, py }) => (
            <g key={label}>
              <line x1={PAD.left-5} y1={py} x2={PAD.left} y2={py} stroke="#4a4a60" strokeWidth={1} />
              <text x={PAD.left-8} y={py+3} fill="#8a8aaa" fontSize={9} textAnchor="end">{label}</text>
            </g>
          ))}

          {/* Axis labels */}
          <text x={PAD.left+PW/2} y={H-8} fill="#9a9ab8" fontSize={10} textAnchor="middle" fontWeight={600}>
            {isLive ? "Live Strength →" : "RS Percentile →"}
          </text>
          <text x={16} y={PAD.top+PH/2} fill="#9a9ab8" fontSize={10} textAnchor="middle" fontWeight={600}
                transform={`rotate(-90,16,${PAD.top+PH/2})`}>
            ↑ RS Velocity (wk − mo)
          </text>

          {/* Bubbles — lower score drawn first, top setups on top */}
          {sorted.map((r) => {
            const cx = toX(xVal(r));
            const cy = toY(yVal(r));
            const radius = toR(r.n);
            const isHov = hovered?.name === r.name;
            const isSel = selected?.name === r.name;
            const vis = isVisible(r) || isHov;
            return (
              <g key={`${r.parent}-${r.name}`} style={{ cursor: "pointer" }}
                 onMouseEnter={() => setHovered(r)}
                 onMouseLeave={() => setHovered(null)}
                 onClick={() => handleBubble(r)}>
                {isSel && (
                  <circle cx={cx} cy={cy} r={radius+5} fill="none" stroke="#fff" strokeWidth={2} opacity={0.8} />
                )}
                <circle cx={cx} cy={cy} r={isHov ? radius+2 : radius}
                        fill={vis ? bubbleFill(r) : "#2a2a3a"}
                        fillOpacity={isMuted(r) ? 0.15 : isHov ? 0.95 : vis ? 0.85 : 0.4}
                        stroke={isHov || isSel ? "#fff" : "none"}
                        strokeWidth={2} />
                {vis && !isMuted(r) && (
                  <text x={cx} y={cy - radius - 4}
                        fill={isHov ? "#fff" : "#c0c0d8"}
                        fontSize={isHov ? 10 : 8} fontWeight={isHov ? 700 : 600}
                        textAnchor="middle" style={{ pointerEvents: "none" }}>
                    {r.name.length > 16 ? r.name.slice(0, 14) + "…" : r.name}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Hover tooltip */}
        {hovered && (() => {
          const vel = rawVel(hovered);
          const setup = isLive ? hovered.live_setup : hovered.daily_setup;
          const tier = setup ? setupTier(setup.score) : null;
          return (
            <div style={{
              position: "absolute", top: 10, right: 10,
              background: "#1c1c30", border: "1px solid #3a3a5a",
              borderRadius: 6, padding: "10px 14px", fontSize: 11,
              minWidth: 200, pointerEvents: "none", zIndex: 10,
              boxShadow: "0 4px 20px rgba(0,0,0,0.7)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                {tier && (
                  <span style={{
                    fontSize: 10, fontWeight: 800, padding: "1px 6px", borderRadius: 3,
                    background: tier.bg, color: tier.color, border: `1px solid ${tier.color}60`,
                    fontFamily: "monospace",
                  }}>{tier.tier}·{setup.score}</span>
                )}
                <span style={{ fontWeight: 700, color: "#fff", fontSize: 12 }}>{hovered.name}</span>
              </div>
              <div style={{ color: "#6a9eff", fontSize: 10, marginBottom: 8 }}>{hovered.parent}</div>
              <div style={{ color: "#c8c8e0", lineHeight: 2, fontSize: 11 }}>
                RS <strong>{hovered.rs?.toFixed(0) ?? "—"}</strong>
                {" · "}Vel <strong style={{ color: vel >= 0 ? "#69f0ae" : "#ef9a9a" }}>{vel > 0 ? "+" : ""}{vel.toFixed(0)}</strong>
                <br />
                {isLive && hovered.live_pct_med != null && (
                  <>Today <strong style={{ color: bubbleFill(hovered) }}>
                    {hovered.live_pct_med > 0 ? "+" : ""}{hovered.live_pct_med.toFixed(2)}%
                  </strong>{" · "}</>
                )}
                CRP <strong>{hovered.live_crp_med != null ? `${hovered.live_crp_med.toFixed(0)}%` : "—"}</strong> of range
                {" · "}N={hovered.n}
                {hovered.vol_regime && hovered.vol_regime !== "QUIET" && (
                  <><br />{volRegimeStyle(hovered.vol_regime).icon} {hovered.vol_regime}</>
                )}
                {hovered.persistence?.streak >= 2 && (
                  <><br />↻ {hovered.persistence.streak}d streak</>
                )}
              </div>
              <div style={{ marginTop: 8, color: "#5a5a7a", fontSize: 9 }}>click to expand constituents</div>
            </div>
          );
        })()}
      </div>

      {/* Parent theme legend — hover to highlight all subthemes in that parent */}
      <div style={{
        width: 180, background: "#0c0c1c", borderLeft: "1px solid #1e1e34",
        padding: "10px 8px", overflowY: "auto", maxHeight: 520,
      }}>
        <div style={{
          fontSize: 9, color: "#7a7a9a", fontWeight: 700, textTransform: "uppercase",
          letterSpacing: 0.5, padding: "0 4px 8px", borderBottom: "1px solid #1e1e34", marginBottom: 6,
        }}>
          Parent themes · {parentStats.length}
        </div>
        {filterParent && (
          <div onClick={() => setFilterParent(null)}
            style={{
              fontSize: 10, color: "#6a9eff", padding: "4px 6px", marginBottom: 4,
              cursor: "pointer", borderRadius: 3, background: "#15152a",
            }}>
            ✕ showing only {filterParent}
          </div>
        )}
        {parentStats.map((p) => {
          const isFiltered = filterParent === p.name;
          const isHi = !filterParent && hoverParent === p.name;
          const isActive = isFiltered || isHi;
          const setupColor = p.avgSetup >= 70 ? "#00c853" : p.avgSetup >= 50 ? "#7cb342" : p.avgSetup >= 30 ? "#fbbf24" : "#9090a0";
          return (
            <div key={p.name}
              onMouseEnter={() => setHoverParent(p.name)}
              onMouseLeave={() => setHoverParent((cur) => cur === p.name ? null : cur)}
              onClick={() => { setFilterParent(isFiltered ? null : p.name); setHoverParent(null); }}
              style={{
                padding: "5px 6px", marginBottom: 2, borderRadius: 3, cursor: "pointer",
                background: isFiltered ? "#1f2c4a" : isHi ? "#1c2238" : "transparent",
                border: `1px solid ${isFiltered ? "#5a7eef" : isHi ? "#3a4a7a" : "transparent"}`,
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4,
              }}>
              <span style={{
                color: isActive ? "#fff" : "#c0c0d8", fontSize: 10, fontWeight: isActive ? 700 : 500,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
              }}>
                {p.name}
              </span>
              <span style={{ display: "flex", gap: 4, fontSize: 9, fontFamily: "monospace", flexShrink: 0 }}>
                <span style={{ color: setupColor, fontWeight: 700 }} title={`avg setup ${p.avgSetup}`}>{p.avgSetup}</span>
                <span style={{ color: "#5a5a7a" }}>·</span>
                <span style={{ color: "#7a7a9a" }} title={`${p.n} subthemes`}>{p.n}</span>
              </span>
            </div>
          );
        })}
      </div>
      </div>

      {/* Expanded constituent panel */}
      {selected && (() => {
        const r = selected;
        const setup = isLive ? r.live_setup : r.daily_setup;
        const tier = setup ? setupTier(setup.score) : null;
        const vel = rawVel(r);
        return (
          <div style={{ padding: "10px 16px 14px", background: "#0a0a14", borderTop: "1px solid #1a1a2e", fontSize: 11 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
              {tier && (
                <span style={{
                  fontSize: 11, fontWeight: 800, padding: "2px 7px", borderRadius: 3,
                  background: tier.bg, color: tier.color, border: `1px solid ${tier.color}60`, fontFamily: "monospace",
                }}>{tier.tier}·{setup.score}</span>
              )}
              <span style={{ fontWeight: 700, color: "#fff", fontSize: 13 }}>{r.name}</span>
              <span style={{ color: "#5a9eff", fontSize: 11 }}>{r.parent}</span>
              <span style={{ color: vel >= 0 ? "#69f0ae" : "#ef9a9a", fontFamily: "monospace", fontSize: 10 }}>
                vel {vel > 0 ? "+" : ""}{vel.toFixed(0)}
              </span>
              {r.rvol_agg != null && (
                <span style={{ color: bubbleFill(r), fontFamily: "monospace", fontSize: 10 }}>
                  RVol {r.rvol_agg.toFixed(1)}x
                </span>
              )}
              <button onClick={() => setSelected(null)}
                style={{ marginLeft: "auto", background: "none", border: "none", color: "#5a5a6a", cursor: "pointer", fontSize: 13 }}>✕</button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {[...(r.tickers || [])]
                .sort((a, b) => isLive
                  ? ((b.live_pct ?? b.chg ?? -999) - (a.live_pct ?? a.chg ?? -999))
                  : ((b.rs ?? 0) - (a.rs ?? 0)))
                .map((t) => {
                  const ticker = typeof t === "string" ? t : t.ticker;
                  const pct = isLive ? (t.live_pct ?? t.chg) : null;
                  const rs = t.rs ?? null;
                  return (
                    <span key={ticker}
                      onClick={(e) => { e.stopPropagation(); onTickerClick?.(ticker); }}
                      style={{
                        padding: "3px 8px", borderRadius: 3, cursor: "pointer",
                        background: "#141420", border: "1px solid #222230",
                        color: "#e0e0e8", fontSize: 11, fontFamily: "monospace",
                        display: "flex", alignItems: "center", gap: 4,
                      }}>
                      {ticker}
                      {pct != null && (
                        <span style={{ color: pct >= 0 ? "#7cb342" : "#e57373", fontSize: 9 }}>
                          {pct > 0 ? "+" : ""}{pct.toFixed(1)}%
                        </span>
                      )}
                      {!isLive && rs != null && (
                        <span style={{ color: rsBarColor(rs), fontSize: 9 }}>{rs.toFixed(0)}</span>
                      )}
                    </span>
                  );
                })}
            </div>
          </div>
        );
      })()}

      {/* Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, padding: "6px 14px 10px", fontSize: 10, color: "#7a7a9a", borderTop: "1px solid #2a2a40" }}>
        <span>● size = N stocks</span>
        <span><span style={{ color: "#00e676" }}>●</span> green = leading today (relative) · <span style={{ color: "#e53935" }}>●</span> red = lagging today</span>
        <span style={{ color: "#9a9ab8" }}>top 30 by setup score colored · rest faded · hover any to inspect</span>
      </div>
    </div>
  );
}

// ─── Sub-component: the actual table of rows ────────────────────────────────
function SubthemeTable({ rows, onTickerClick, timeframe = "daily", sortBy, sortDir, onSort, showTickers = false, portfolioSet = null, watchlistSet = null, liveQuotes = null }) {
  if (!rows.length) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "#5a5a6a", fontSize: 12 }}>
        No subthemes match the current filters.
      </div>
    );
  }

  const isLive = timeframe === "live";
  const gridCols = isLive
    ? "minmax(160px, 1.5fr) 2fr 60px 60px"
    : "minmax(160px, 1.5fr) 2fr 50px 50px";

  const hdrStyle = (key) => ({
    textAlign: "center", cursor: onSort ? "pointer" : "default", userSelect: "none",
    color: sortBy === key ? "#00c853" : "#9090a0",
    display: "flex", alignItems: "center", justifyContent: "center", gap: 2,
  });
  const arrow = (key) => sortBy === key ? (sortDir === "desc" ? " ▼" : " ▲") : "";

  return (
    <div style={{ background: "#0d0d1a", border: "1px solid #222230", borderRadius: 6, overflowX: "auto", minWidth: 0 }}>
      {/* Header row */}
      <div style={{
        display: "grid",
        gridTemplateColumns: gridCols,
        gap: 8, padding: "6px 10px", background: "#1a1a2e",
        fontSize: 8, color: "#9090a0", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5,
        alignItems: "center",
      }}>
        <span>Subtheme</span>
        <span style={{ textAlign: "center", cursor: onSort ? "pointer" : "default", color: sortBy === "rs" || sortBy === "live_strength" ? "#00c853" : "#9090a0" }}
              onClick={() => onSort?.(isLive ? "live_strength" : "rs")}>
          {isLive ? "Strength" : "RS"}{arrow(isLive ? "live_strength" : "rs")}
        </span>
        <span style={hdrStyle(isLive ? "live_pct" : "d1")} onClick={() => onSort?.(isLive ? "live_pct" : "d1")}>
          {isLive ? "Day %" : "1W Δ"}{arrow(isLive ? "live_pct" : "d1")}
        </span>
        <span style={hdrStyle("crp_med")} onClick={() => onSort?.("crp_med")}>
          CRP%{arrow("crp_med")}
        </span>
      </div>

      {rows.map((r, i) => (
        <SubthemeRow
          key={`${r.parent}-${r.name}-${i}`}
          row={r}
          onTickerClick={onTickerClick}
          timeframe={timeframe}
          showTickers={showTickers}
          portfolioSet={portfolioSet}
          watchlistSet={watchlistSet}
          liveQuotes={liveQuotes}
        />
      ))}
    </div>
  );
}

// ─── Single subtheme row ────────────────────────────────────────────────────
function SubthemeRow({ row, onTickerClick, timeframe = "daily", showTickers = false, portfolioSet = null, watchlistSet = null, liveQuotes = null }) {
  // Resolve RVol the same way the watchlist does: prefer live FMP volume / avgVolume,
  // fall back to the pipeline-cached t.rvol when the ticker isn't in liveQuotes.
  const liveRvol = (t) => {
    const tk = typeof t === "string" ? t : t?.ticker;
    const lq = tk && liveQuotes ? liveQuotes[tk.toUpperCase()] || liveQuotes[tk] : null;
    if (lq?.volume && lq?.avgVolume && lq.avgVolume > 0) {
      return Math.round((lq.volume / lq.avgVolume) * 10) / 10;
    }
    return typeof t === "object" ? (t.rvol ?? null) : null;
  };
  const livePctOf = (t) => {
    const tk = typeof t === "string" ? t : t?.ticker;
    const lq = tk && liveQuotes ? liveQuotes[tk.toUpperCase()] || liveQuotes[tk] : null;
    if (lq?.change != null && !isNaN(lq.change)) return lq.change;
    return typeof t === "object" ? (t.live_pct ?? t.chg ?? null) : null;
  };
  const [expanded, setExpanded] = useState(false);
  const isLive = timeframe === "live";

  // Choose displayed values per timeframe
  const barValue = isLive ? (row.live_strength_score ?? 0) : (row.rs ?? 0);
  const barColor = rsBarColor(barValue);
  const persistBadge = persistenceBadge(row.persistence);
  const volStyle = isLive ? volRegimeStyle(row.vol_regime) : null;

  // Setup score badge — the headline composite indicator
  const setupData = isLive ? row.live_setup : row.daily_setup;
  const tier = setupData ? setupTier(setupData.score) : null;

  const gridCols = isLive
    ? "minmax(160px, 1.5fr) 2fr 60px 60px"
    : "minmax(160px, 1.5fr) 2fr 50px 50px";

  return (
    <>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "grid",
          gridTemplateColumns: gridCols,
          gap: 8, padding: "6px 10px",
          borderTop: "1px solid #1a1a2e",
          fontSize: 12, alignItems: "center", cursor: "pointer",
          background: expanded ? "#141430" : "transparent",
        }}
      >
        {/* Subtheme name + setup tier + arrow + persistence + vol regime */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          {row.quad && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: "1px 4px", borderRadius: 2,
              background: quadColor(row.quad), color: "#0d0d1a", minWidth: 14, textAlign: "center",
            }}>{row.quad}</span>
          )}
          {showTickers ? (
            <span style={{ display: "flex", flexWrap: "wrap", gap: 3, minWidth: 0, overflow: "hidden" }}
                  title={row.name}>
              {(row.tickers || []).slice(0, 12).map((t) => {
                const tk = typeof t === "string" ? t : t?.ticker;
                if (!tk) return null;
                const rvol = liveRvol(t);
                const pct = livePctOf(t);
                // Only color (green/amber) when the ticker is UP today; otherwise grey.
                // Volume conviction without an upward move isn't actionable here.
                const isUp = pct != null && pct > 0;
                const color = !isUp                    ? "#7a7a8a"
                            : rvol == null             ? "#7a7a8a"
                            : rvol >= 2                ? "#00c853"
                            : rvol >= 1.5              ? "#fbbf24"
                            :                            "#7a7a8a";
                const inPort = portfolioSet?.has(tk.toUpperCase()) ?? false;
                const inWatch = !inPort && (watchlistSet?.has(tk.toUpperCase()) ?? false);
                const bg = inPort ? "#3a2a08" : inWatch ? "#0d2218" : "#141420";
                const bd = inPort ? "#ffd700" : inWatch ? "#2c5e3e" : "#222230";
                const bw = inPort ? 2 : 1;
                return (
                  <span key={tk}
                    onClick={(e) => { e.stopPropagation(); onTickerClick?.(tk); }}
                    style={{
                      fontFamily: "monospace", fontSize: 10, fontWeight: 600,
                      padding: inPort ? "0 3px" : "1px 4px", borderRadius: 2, cursor: "pointer",
                      background: bg, border: `${bw}px solid ${bd}`, color,
                      boxShadow: inPort ? "0 0 4px rgba(255, 215, 0, 0.4)" : undefined,
                    }}
                    title={
                      `${tk}` +
                      (inPort ? " · in portfolio" : inWatch ? " · in watchlist" : "") +
                      (pct != null ? ` · ${pct > 0 ? "+" : ""}${pct.toFixed(2)}%` : "") +
                      (rvol != null ? ` · RVol ${rvol.toFixed(2)}x` : "")
                    }>
                    {tk}
                  </span>
                );
              })}
              {(row.tickers || []).length > 12 && (
                <span style={{ fontSize: 9, color: "#5a5a6a" }}>+{row.tickers.length - 12}</span>
              )}
            </span>
          ) : (
            <span style={{ color: "#c8c8d8", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {row.name}
            </span>
          )}
          <span style={{
            color: deltaColor(isLive ? (row.live_pct_med ?? 0) * 2 : row.d1),
            fontWeight: 700, fontFamily: "monospace",
          }}>
            {deltaArrow(isLive ? (row.live_pct_med ?? 0) * 2 : row.d1)}
          </span>

          {/* New leader — crossed into LEADING quadrant today vs yesterday */}
          {row.persistence?.new_leader && (
            <span title="Crossed into LEADING quadrant today (rs ≥ 50, accelerating). Was not leading yesterday."
              style={{
                fontSize: 9, fontWeight: 800,
                padding: "1px 5px", borderRadius: 2,
                background: "#0a3a1f", color: "#00e676",
                border: "1px solid #00e67660",
                fontFamily: "monospace", flexShrink: 0, letterSpacing: 0.5,
              }}>
              ★NEW
            </span>
          )}

          {/* Persistence badge — shows leadership memory */}
          {persistBadge && (
            <span title={persistBadge.title} style={{
              fontSize: 9, fontWeight: 700,
              padding: "1px 5px", borderRadius: 2,
              background: persistBadge.bg, color: persistBadge.color,
              border: `1px solid ${persistBadge.color}40`,
              fontFamily: "monospace",
              flexShrink: 0,
            }}>
              {persistBadge.label}
            </span>
          )}

          {/* Volume regime indicator (live mode only) */}
          {isLive && volStyle && row.vol_regime && row.vol_regime !== "QUIET" && (
            <span title={`Volume: ${volStyle.label} — RVol med ${row.live_rvol_med?.toFixed(2)}x, ${row.live_rvol_breadth?.toFixed(0)}% of names ≥1.5x`}
              style={{
                fontSize: 10, fontWeight: 700,
                padding: "1px 5px", borderRadius: 2,
                background: volStyle.bg, color: volStyle.color,
                border: `1px solid ${volStyle.color}40`,
                flexShrink: 0,
              }}>
              {volStyle.icon}
            </span>
          )}
        </div>

        {/* Bar + number overlaid. In live mode, a cyan tick shows daily RS
            so you can compare today's strength to the underlying RS rank. */}
        <div style={{ position: "relative", height: 16, background: "#1a1a2e", borderRadius: 2, overflow: "hidden" }}
             title={isLive && row.rs != null ? `Live strength ${barValue.toFixed(0)} · daily RS ${row.rs.toFixed(0)} (white tick)` : undefined}>
          <div style={{
            width: `${Math.max(0, Math.min(100, barValue))}%`,
            height: "100%", background: barColor,
            transition: "width 0.3s ease",
          }} />
          <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "#2a2a40" }} />
          <div style={{ position: "absolute", left: "80%", top: 0, bottom: 0, width: 1, background: "#3a3a50" }} />
          {isLive && row.rs != null && (
            <div style={{
              position: "absolute",
              left: `calc(${Math.max(0, Math.min(100, row.rs))}% - 1px)`,
              top: 1, bottom: 1, width: 2,
              background: "#ffffff",
              boxShadow: "0 0 3px rgba(255, 255, 255, 0.8)",
              pointerEvents: "none",
            }} />
          )}
          <span style={{
            position: "absolute", right: 4, top: 0, bottom: 0,
            display: "flex", alignItems: "center", gap: 4,
            color: "#fff", fontFamily: "monospace", fontWeight: 700, fontSize: 10,
          }}>
            {barValue.toFixed(0)}
            {isLive && row.rs != null && (
              <span style={{ color: "#ffffff", fontSize: 9, fontWeight: 600, opacity: 0.85 }}>
                /{row.rs.toFixed(0)}
              </span>
            )}
          </span>
        </div>

        {/* Col 4: 1D/1W delta (daily) OR today % (live, with SPY-relative below) */}
        {isLive ? (
          <span style={{
            display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1.1,
          }}
            title={row.live_pct_rel_spy != null
              ? `Today ${row.live_pct_med?.toFixed(2)}% absolute · ${row.live_pct_rel_spy > 0 ? "+" : ""}${row.live_pct_rel_spy.toFixed(2)}% relative to SPY`
              : "Today % (median across constituents)"}>
            <span style={{
              color: deltaColor((row.live_pct_med ?? 0) * 2),
              fontFamily: "monospace", fontWeight: 600,
            }}>
              {row.live_pct_med != null ? `${row.live_pct_med > 0 ? "+" : ""}${row.live_pct_med.toFixed(2)}%` : "—"}
            </span>
            {row.live_pct_rel_spy != null && Math.abs(row.live_pct_rel_spy) >= 0.1 && (
              <span style={{
                color: row.live_pct_rel_spy >= 0.5 ? "#7cb342"
                     : row.live_pct_rel_spy <= -0.5 ? "#c47000"
                     : "#6a6a80",
                fontSize: 8, fontFamily: "monospace", fontWeight: 500,
              }}>
                {row.live_pct_rel_spy > 0 ? "+" : ""}{row.live_pct_rel_spy.toFixed(1)} vs SPY
              </span>
            )}
          </span>
        ) : (
          <span title={row.d1_label || "1W Δ"} style={{ textAlign: "center", color: deltaColor(row.d1), fontFamily: "monospace", fontWeight: 600 }}>
            {row.d1 > 0 ? "+" : ""}{row.d1?.toFixed(0)}
          </span>
        )}

        {/* CRP% — median closing range position across constituents.
            100 = closing at day's high (strong), 0 = at day's low (weak) */}
        <span style={{
          textAlign: "center", fontFamily: "monospace", fontWeight: 600,
          color: row.live_crp_med >= 75 ? "#00c853"
               : row.live_crp_med >= 50 ? "#7cb342"
               : row.live_crp_med <= 25 ? "#e53935"
               : "#7a7a8a",
        }}
          title={`Median closing range: ${row.live_crp_med?.toFixed(0) ?? "—"}% of today's high-low range. 100 = closing near highs.`}>
          {row.live_crp_med != null ? `${row.live_crp_med.toFixed(0)}%` : "—"}
        </span>

      </div>

      {/* Expanded constituent panel */}
      {expanded && (
        <div style={{ padding: "8px 16px 12px", background: "#0a0a14", borderTop: "1px solid #1a1a2e", fontSize: 11 }}>
          <div style={{ marginBottom: 6, color: "#7a7a8a", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5,
                         display: "flex", flexWrap: "wrap", gap: 12 }}>
            {/* Setup score breakdown — show what's driving the composite */}
            {setupData && tier && (
              <span style={{ color: tier.color, fontWeight: 700 }}>
                ⭐ Setup {tier.tier}·{setupData.score} ({tier.label}) ·
                Str {setupData.strength} · Dir {setupData.direction} · Conv {setupData.conviction}
              </span>
            )}
            <span>
              {isLive
                ? `Constituents · sorted by today % · σ=${row.live_dispersion?.toFixed(2) ?? "n/a"}% · ${row.a_grades || 0} A-grades`
                : `Constituents · sorted by RS · σ=${row.dispersion?.toFixed(1) ?? "n/a"} · ${row.a_grades || 0} A-grades`}
            </span>
            {row.persistence && (
              <span style={{ color: "#9090a0" }}>
                · Memory: {row.persistence.streak}d streak ·
                {row.persistence.days_in_top}/{row.persistence.lookback} days in top-{TOP_N_PERSIST}
                {row.persistence.first_seen && ` · first seen ${row.persistence.first_seen}`}
              </span>
            )}
            {isLive && row.vol_regime && (
              <span style={{ color: volStyle.color, fontWeight: 700 }}>
                · {volStyle.icon} {volStyle.label}
                {row.live_rvol_med != null && ` · ${row.live_rvol_med.toFixed(2)}x med RVol`}
                {row.live_rvol_breadth != null && ` · ${row.live_rvol_breadth.toFixed(0)}% at ≥1.5x`}
              </span>
            )}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {[...(row.tickers || [])]
              .sort((a, b) => isLive
                ? ((b.live_pct ?? b.chg ?? -999) - (a.live_pct ?? a.chg ?? -999))
                : ((b.rs ?? 0) - (a.rs ?? 0)))
              .slice(0, 20)
              .map((t) => {
                const livePct = livePctOf(t);
                const rvol = liveRvol(t);
                const pctStr = livePct != null
                  ? `${livePct > 0 ? "+" : ""}${livePct.toFixed(1)}%`
                  : "—";
                const rvolStr = rvol != null ? `${rvol.toFixed(2)}x` : "—";
                const cellColor = isLive
                  ? (livePct >= 3 ? "#00c853" : livePct >= 1 ? "#7cb342" : livePct <= -3 ? "#e53935" : livePct <= -1 ? "#fb8c00" : "#9090a0")
                  : (t.rs >= 70 ? "#00c853" : t.rs >= 40 ? "#e0e0e8" : "#fb8c00");
                const bgColor = isLive
                  ? (livePct >= 3 ? "#0d2a1a" : livePct <= -3 ? "#1a0d0d" : "#141420")
                  : (t.rs >= 70 ? "#0d2a1a" : t.rs >= 40 ? "#141420" : "#1a0d0d");
                const rvolColor = rvol == null ? "#5a5a6a"
                                : rvol >= 2   ? "#00c853"
                                : rvol >= 1.5 ? "#fbbf24"
                                :               "#7a7a8a";
                return (
                  <button
                    key={t.ticker}
                    onClick={(e) => {
                      e.stopPropagation();
                      onTickerClick?.(t.ticker);
                    }}
                    title={`${t.ticker} · ${pctStr} · RVol ${rvolStr}`}
                    style={{
                      padding: "3px 8px", borderRadius: 3, border: "1px solid #222230",
                      background: bgColor, color: cellColor,
                      fontSize: 11, fontFamily: "monospace", fontWeight: 600,
                      cursor: "pointer", display: "flex", gap: 6, alignItems: "center",
                    }}
                  >
                    <span>{t.ticker}</span>
                    {isLive && (
                      <>
                        <span style={{ color: cellColor, fontSize: 10 }}>{pctStr}</span>
                        <span style={{ color: "#3a3a4a", fontSize: 10 }}>|</span>
                        <span style={{ color: rvolColor, fontSize: 10 }}>{rvolStr}</span>
                      </>
                    )}
                    {!isLive && (
                      <span style={{ color: "#7a7a8a", fontSize: 10 }}>
                        {t.rs?.toFixed(0) ?? "—"}
                      </span>
                    )}
                  </button>
                );
            })}
          </div>
        </div>
      )}
    </>
  );
}

// ─── Auto-refresh wrapper (optional) ────────────────────────────────────────
// Wrap your usage like:
//   <SubthemeRotationAutoRefresh dataUrl="/dashboard_data.json" onTickerClick={...} />
//
// Default: refresh every 5 min during market hours (6:30am-1:10pm PT, Mon-Fri),
// and every 30 min outside market hours. The pipeline pushes new data on its
// own schedule (intraday_refresh.sh runs every 30 min); the client polling just
// ensures the page picks it up.
//
// History file (subtheme_history.json) is loaded once on mount — it's daily
// data so doesn't need intraday refresh. If the file is missing, the component
// gracefully degrades (no persistence badges, but everything else works).

export function SubthemeRotationAutoRefresh({
  dataUrl = "/dashboard_data.json",
  historyUrl = "/subtheme_history.json",
  liveUrl = "/api/live",
  marketHoursMs = 5 * 60 * 1000,
  offHoursMs = 30 * 60 * 1000,
  liveQuoteMs = 30 * 1000,                  // poll fresh quotes every 30s
  liveQuoteChunkSize = 400,                 // tickers per chunk request
  liveQuoteMaxChunks = null,                // null = no cap (cover full universe)
  portfolio = [],
  watchlist = [],
  onTickerClick,
}) {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState(null);
  const [loadedAt, setLoadedAt] = useState(null);
  const [liveQuotes, setLiveQuotes] = useState({});  // ticker → { change, volume, avgVolume }
  const [quotesAt, setQuotesAt] = useState(null);

  const isMarketHours = () => {
    const now = new Date();
    const ptStr = now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
    const pt = new Date(ptStr);
    const dow = pt.getDay();
    if (dow === 0 || dow === 6) return false;
    const minutes = pt.getHours() * 60 + pt.getMinutes();
    return minutes >= 6 * 60 + 25 && minutes <= 13 * 60 + 10;
  };

  // Load history once on mount (daily data, refreshes once per day)
  useEffect(() => {
    let cancelled = false;
    const loadHistory = async () => {
      try {
        const r = await fetch(`${historyUrl}?t=${Date.now()}`);
        if (!r.ok) {
          // File missing is OK — component degrades gracefully
          if (!cancelled) setHistory(null);
          return;
        }
        const j = await r.json();
        if (!cancelled) setHistory(j);
      } catch (e) {
        // Non-fatal — persistence features just won't render
        console.warn("subtheme_history.json not available:", e?.message);
        if (!cancelled) setHistory(null);
      }
    };
    loadHistory();
    return () => { cancelled = true; };
  }, [historyUrl]);

  useEffect(() => {
    let stopped = false;
    let timer = null;

    const load = async () => {
      try {
        const r = await fetch(`${dataUrl}?t=${Date.now()}`);
        const j = await r.json();
        if (!stopped) {
          setData(j);
          setLoadedAt(new Date());
        }
      } catch (e) {
        console.error("Failed to load dashboard_data.json:", e);
      }
      if (!stopped) {
        const interval = isMarketHours() ? marketHoursMs : offHoursMs;
        timer = setTimeout(load, interval);
      }
    };

    load();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [dataUrl, marketHoursMs, offHoursMs]);

  // ── Build the unique-ticker universe from data ──
  // SPY is always included so we can compute theme-vs-SPY relative move.
  const tickerUniverse = useMemo(() => {
    if (!data?.themes) return [];
    const set = new Set(["SPY"]);
    data.themes.forEach((th) => (th.subthemes || []).forEach((sub) => {
      (sub.tickers || []).forEach((t) => {
        const tk = typeof t === "string" ? t : t?.ticker;
        if (tk) set.add(tk);
      });
    }));
    return [...set];
  }, [data]);

  // ── Poll /api/live for fresh quotes during market hours ──
  // Pipeline-baked live_pct goes stale between intraday runs (e.g. 10:30 AM →
  // 6 PM ET gap), so we overlay real-time quotes from FMP via /api/live.
  useEffect(() => {
    if (!tickerUniverse.length) return;
    let stopped = false;
    let timer = null;

    const fetchChunk = async (chunk) => {
      const url = `${liveUrl}?tickers=${chunk.join(",")}&t=${Date.now()}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`live ${r.status}`);
      const j = await r.json();
      // /api/live returns { watchlist: [...], universe: [...] }
      return [...(j.watchlist || []), ...(j.universe || [])];
    };

    const load = async () => {
      if (!isMarketHours()) {
        // Off-hours: don't bother polling, but still re-check periodically
        if (!stopped) timer = setTimeout(load, liveQuoteMs * 4);
        return;
      }
      try {
        const chunks = [];
        for (let i = 0; i < tickerUniverse.length; i += liveQuoteChunkSize) {
          if (liveQuoteMaxChunks != null && chunks.length >= liveQuoteMaxChunks) break;
          chunks.push(tickerUniverse.slice(i, i + liveQuoteChunkSize));
        }
        const results = await Promise.all(chunks.map(fetchChunk));
        if (stopped) return;
        const next = {};
        results.flat().forEach((q) => {
          if (q?.ticker) {
            next[q.ticker] = {
              change: q.change,
              volume: q.volume,
              avgVolume: q.avgVolume,
              price: q.price,
              dayHigh: q.dayHigh,
              dayLow: q.dayLow,
            };
          }
        });
        setLiveQuotes(next);
        setQuotesAt(new Date());
      } catch (e) {
        console.warn("live quote refresh failed:", e?.message);
      }
      if (!stopped) timer = setTimeout(load, liveQuoteMs);
    };

    load();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [tickerUniverse, liveUrl, liveQuoteMs, liveQuoteChunkSize, liveQuoteMaxChunks]);

  if (!data) {
    return (
      <div style={{ padding: 24, color: "#5a5a6a", fontSize: 12, fontFamily: "system-ui" }}>
        Loading subtheme data…
      </div>
    );
  }

  const refreshIntervalMin = Math.round((isMarketHours() ? marketHoursMs : offHoursMs) / 60000);
  const marketStatus = isMarketHours() ? "● market open" : "○ off-hours";
  const historyStatus = history?.days?.length
    ? `${history.days.length}d memory`
    : "no memory file";

  // Quote freshness indicator
  const quoteAgeSec = quotesAt ? Math.round((Date.now() - quotesAt.getTime()) / 1000) : null;
  const quotesFresh = quoteAgeSec != null && quoteAgeSec < 90;
  const quoteStatus = quotesAt
    ? `quotes ${quoteAgeSec}s old (${Object.keys(liveQuotes).length} tickers)`
    : isMarketHours() ? "fetching live quotes…" : "live quotes paused";

  return (
    <>
      <SubthemeRotation
        data={data}
        history={history}
        liveQuotes={liveQuotes}
        portfolio={portfolio}
        watchlist={watchlist}
        onTickerClick={onTickerClick}
      />
      {loadedAt && (
        <div style={{ padding: "0 16px 12px", color: "#5a5a6a", fontSize: 10, fontFamily: "system-ui",
                       display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <span>File refreshed: {loadedAt.toLocaleTimeString()} · Next in {refreshIntervalMin} min · {historyStatus}</span>
          <span style={{ display: "flex", gap: 12 }}>
            <span style={{ color: quotesFresh ? "#00c853" : isMarketHours() ? "#fb8c00" : "#5a5a6a" }}>
              {quotesFresh ? "● LIVE" : isMarketHours() ? "◌" : "○"} {quoteStatus}
            </span>
            <span style={{ color: isMarketHours() ? "#00c853" : "#5a5a6a" }}>{marketStatus}</span>
          </span>
        </div>
      )}
    </>
  );
}
