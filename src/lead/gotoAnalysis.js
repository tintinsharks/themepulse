// Pure Go-To Screen Leading Tickers (by Grade) & Theme Cluster Analysis engine.
// Shared by both Node briefing scripts (scripts/zanger-scan.mjs & zanger-briefing.mjs)
// and the React Brief UI (src/lead/Brief.jsx & ZangerBriefSection.jsx).

import {
  isHealthcareItem,
  scoreAPlusSetup,
  stockThrust,
} from "./math.js";
import { filterRecentHeadlines } from "./briefLive.js";

export const GOTO_STORAGE_KEY = "tp-brief-goto-preset-v2";

export const DEFAULT_GOTO_EXCLUDED = [
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

export const DEFAULT_GOTO_PRESET = {
  catTab: "all",
  baseFilter: "all",
  boFilter: null,
  only9M: false,
  onlyOrh: false,
  only30m: false,
  onlyNear52w: true,
  onlyFresh: true,
  onlyEmaStack: false,
  onlyPp: false,
  minDollarVol: 20e6,
  noHealth: true,
  themeFilter: null,
  excludedThemes: DEFAULT_GOTO_EXCLUDED,
  minAdr: 3.5,
  minZvr: 1.0,
  minRs: 0,
  epsOnly: false,
  cleanOnly: false,
};

const CATALYST_PATTERNS = [
  { re: /\b(beats?\s+by|earnings?\s+beat|eps\s+beat|top(?:s|ped)\s+estimates?|blowout|strong\s+q[1-4]|q[1-4]\s+results?)\b/i, label: "earnings beats" },
  { re: /\b(raises?\s+guidance|ups?\s+outlook|guidance\s+above|outlook\s+raised|lifts?\s+forecast)\b/i, label: "raised guidance" },
  { re: /\b(upgrade[ds]?|price\s+target\s+raised|pt\s+raised|outperform|overweight|initiates?\s+(?:at\s+)?buy|bullish)\b/i, label: "analyst upgrades" },
  { re: /\b(acquir|buyout|takeover|merger|strategic\s+alternatives|deal\s+to\s+buy)\b/i, label: "M&A / deal activity" },
  { re: /\b(ai\b|artificial\s+intelligence|cloud|cyber|zero\s+trust|endpoint|ransomware|security|data\s+center)\b/i, label: "AI / cloud / security demand" },
  { re: /\b(contract|partnership|awarded|wins?\s+deal|launches?|expansion|record\s+backlog)\b/i, label: "contract / product catalysts" },
  { re: /\b(buyback|repurchase|dividend|special\s+dividend)\b/i, label: "capital return / buybacks" },
];

export function detectCatalystDrivers(titles = []) {
  const hits = [];
  const joined = titles.filter(Boolean).join(" | ");
  if (!joined) return hits;
  for (const p of CATALYST_PATTERNS) {
    if (p.re.test(joined)) hits.push(p.label);
  }
  return hits.slice(0, 3);
}

// Apply Go-To preset criteria to an array of scoreZangerCandidate rows.
export function filterGoToCandidates(allScored = [], { preset = DEFAULT_GOTO_PRESET, stockMap = {}, tickerLayer = {} } = {}) {
  const p = { ...DEFAULT_GOTO_PRESET, ...(preset || {}) };
  const excl = new Set(Array.isArray(p.excludedThemes) ? p.excludedThemes : DEFAULT_GOTO_EXCLUDED);

  return (Array.isArray(allScored) ? allScored : []).filter((r) => {
    if (!r?.ticker) return false;
    const s = stockMap?.[r.ticker];
    const tl = tickerLayer?.[r.ticker];
    if (p.baseFilter === "core" && !(r.inCoreBase ?? true)) return false;
    if (p.baseFilter === "adr5liq" && !r.inAdr5Liq) return false;
    if (p.catTab === "bo" && !r.isBreakout) return false;
    if (p.catTab === "zanger" && !r.qualifiesZanger) return false;
    if (p.catTab === "rsl" && !r.rsl) return false;
    if (p.catTab === "leaders" && !(r.tier === "lead" && r.layerStatus === "lead")) return false;
    if (p.boFilter && !(r.breakoutTypes || []).includes(p.boFilter)) return false;
    if (p.only9M) {
      const v = r.volume ?? s?.volume ?? 0;
      if (!r.is9M && v < 8_900_000) return false;
    }
    if (p.onlyNear52w && !(typeof r.off52 === "number" && Number.isFinite(r.off52) && r.off52 >= -15)) return false;
    if (p.onlyFresh) {
      const fresh = r.isFresh != null
        ? Boolean(r.isFresh)
        : Boolean(s?.sma20_pct != null && s.sma20_pct >= -1.0 && (s.sma20_pct / Math.max(s.adr20 ?? s.adr_pct ?? 4, 1.5)) <= 2.0);
      if (!fresh) return false;
    }
    if (p.onlyEmaStack && !(r.emaStack ?? Boolean(s?.ema_stack))) return false;
    if (p.onlyPp && (r.ppCount ?? s?.pp_count_30d ?? 0) < 2) return false;
    if (p.minDollarVol > 0 && (r.avgDollarVol ?? s?.avg_dollar_vol_raw ?? 0) < p.minDollarVol) return false;
    if (p.minZvr > 1.0 && (r.zvr ?? 0) < p.minZvr) return false;
    if (p.minRs > 0 && (r.rs ?? 0) < p.minRs) return false;
    if (p.minAdr != null && (r.adr ?? -1) < p.minAdr) return false;
    if (p.noHealth && isHealthcareItem({
      theme: r.theme || tl?.theme,
      themeId: r.themeId || tl?.themeId,
      layer: r.layer || tl?.name,
      sector: s?.sector,
      industry: s?.industry,
    })) return false;
    if (p.epsOnly && (r.eps ?? 0) < 50) return false;
    if (p.cleanOnly && ((r.layerFlags?.length ? r.layerFlags : tl?.flags) || []).some(([k]) => k === "distrib" || k === "exiting")) return false;
    if (excl.size > 0 && r.theme && excl.has(r.theme)) return false;
    if (p.themeFilter && r.theme !== p.themeFilter) return false;
    return true;
  });
}

function getFreshHeadlinesFor(ticker, row, headlines, now) {
  const rawLive = headlines instanceof Map ? headlines.get(ticker) : headlines?.[ticker];
  const normalizedLive = Array.isArray(rawLive)
    ? rawLive
        .map((h) => (typeof h === "string" ? { title: h } : h))
        .filter((h) => h && h.title)
    : [];
  if (normalizedLive.length) return filterRecentHeadlines(normalizedLive, now, 14).slice(0, 2);
  const rawPipe = Array.isArray(row?.pipelineNews) ? row.pipelineNews : [];
  if (!rawPipe.length) return [];
  const normalizedPipe = rawPipe
    .map((h) => (typeof h === "string" ? { title: h } : h))
    .filter((h) => h && h.title);
  return filterRecentHeadlines(normalizedPipe, now, 14).slice(0, 2);
}

// Build Go-To Leading Tickers (descending A+ -> A -> B -> C grade) & Theme Cluster "Why?" analysis.
export function buildGoToBriefingAnalysis({
  allScored = [],
  preset = DEFAULT_GOTO_PRESET,
  stockMap = {},
  tickerLayer = {},
  layers = [],
  themes = [],
  headlines = null,
  externalWhyByTheme = null,
  maxLeaders = 20,
  maxClusters = 8,
  now = new Date(),
} = {}) {
  const matched = filterGoToCandidates(allScored, { preset, stockMap, tickerLayer });

  // Count green movers per theme inside the Go-To pool for hot-theme cluster scoring
  const greenThemeCounts = new Map();
  for (const r of matched) {
    if ((r.chg ?? 0) > 0 && r.theme && r.theme !== "—") {
      greenThemeCounts.set(r.theme, (greenThemeCounts.get(r.theme) || 0) + 1);
    }
  }

  // Score every matched candidate with A+ Setup Score & ADR-adjusted Thrust
  const graded = matched
    .map((r) => {
      const clusterCount = r.theme ? (greenThemeCounts.get(r.theme) || 0) : 0;
      const ap = scoreAPlusSetup(r, { themeClusterCount: clusterCount });
      const thrust = stockThrust(r.chg, r.zvr, r.adr);
      const freshNews = getFreshHeadlinesFor(r.ticker, r, headlines, now);
      return {
        ticker: r.ticker,
        company: r.company || stockMap?.[r.ticker]?.company || "",
        theme: r.theme || "—",
        layer: r.layer || "—",
        layerStatus: r.layerStatus || "lag",
        tier: r.tier || null,
        grade: ap.grade,
        aPlusScore: ap.score,
        gradeTone: ap.tone,
        aPlusTip: ap.tip,
        price: r.price ?? null,
        chg: r.chg ?? null,
        fromOpen: r.fromOpen ?? null,
        thrust,
        zvr: r.zvr ?? null,
        cr: r.cr ?? null,
        rs: r.rs ?? null,
        eps: r.eps ?? null,
        adr: r.adr ?? null,
        off52: r.off52 ?? null,
        sma20Pct: r.sma20Pct ?? null,
        isFresh: Boolean(r.isFresh),
        emaStack: Boolean(r.emaStack),
        ppCount: r.ppCount ?? 0,
        avgDollarVol: r.avgDollarVol ?? null,
        breakoutTypes: r.breakoutTypes || [],
        isBreakout: Boolean(r.isBreakout),
        qualifiesZanger: Boolean(r.qualifiesZanger),
        inAdr5Liq: Boolean(r.inAdr5Liq),
        rsl: Boolean(r.rsl),
        earningsDays: r.earningsDays ?? null,
        earningsDisplay: r.earningsDisplay || "",
        topHeadline: freshNews[0]?.title || null,
        topHeadlineSource: freshNews[0]?.source || null,
        topHeadlineUrl: freshNews[0]?.url || null,
        headlines: freshNews,
      };
    })
    .sort(
      (a, b) =>
        b.aPlusScore - a.aPlusScore ||
        (b.thrust ?? -999) - (a.thrust ?? -999) ||
        (b.rs ?? 0) - (a.rs ?? 0) ||
        a.ticker.localeCompare(b.ticker)
    );

  const gradeCounts = { "A+": 0, A: 0, B: 0, C: 0 };
  for (const r of graded) {
    if (gradeCounts[r.grade] != null) gradeCounts[r.grade]++;
  }

  // Build theme rotation lookup from themes & layers metadata
  const themeMeta = new Map();
  for (const t of Array.isArray(themes) ? themes : []) {
    if (t?.theme) themeMeta.set(t.theme, t);
  }
  const layersByTheme = new Map();
  for (const l of Array.isArray(layers) ? layers : []) {
    if (!l?.theme) continue;
    if (!layersByTheme.has(l.theme)) layersByTheme.set(l.theme, []);
    layersByTheme.get(l.theme).push(l);
  }

  // Group graded Go-To rows into Theme Clusters
  const byTheme = new Map();
  for (const r of graded) {
    const th = r.theme;
    if (!th || th === "—") continue;
    if (!byTheme.has(th)) byTheme.set(th, []);
    byTheme.get(th).push(r);
  }

  const themeClusters = [];
  for (const [theme, list] of byTheme.entries()) {
    const count = list.length;
    const aPlusCount = list.filter((x) => x.grade === "A+").length;
    const aCount = list.filter((x) => x.grade === "A").length;
    const aPlusACount = aPlusCount + aCount;
    const greenCount = list.filter((x) => (x.chg ?? 0) > 0).length;
    const pctGreen = Math.round((greenCount / count) * 100);
    const chgVals = list.map((x) => x.chg).filter((v) => typeof v === "number" && Number.isFinite(v));
    const avgChg = chgVals.length ? +(chgVals.reduce((s, v) => s + v, 0) / chgVals.length).toFixed(2) : null;
    const zvrVals = list.map((x) => x.zvr).filter((v) => typeof v === "number" && Number.isFinite(v));
    const avgZvr = zvrVals.length ? +(zvrVals.reduce((s, v) => s + v, 0) / zvrVals.length).toFixed(2) : null;
    const rsVals = list.map((x) => x.rs).filter((v) => typeof v === "number" && Number.isFinite(v));
    const avgRs = rsVals.length ? Math.round(rsVals.reduce((s, v) => s + v, 0) / rsVals.length) : null;
    const avgScore = Math.round(list.reduce((s, x) => s + x.aPlusScore, 0) / count);
    const breakoutCount = list.filter((x) => x.isBreakout).length;
    const pp2Count = list.filter((x) => x.ppCount >= 2).length;
    const emaStackCount = list.filter((x) => x.emaStack).length;

    // Sub-layer breakdown
    const layerBuckets = new Map();
    for (const x of list) {
      const lName = x.layer && x.layer !== "—" ? x.layer : "General";
      layerBuckets.set(lName, (layerBuckets.get(lName) || 0) + 1);
    }
    const subLayers = [...layerBuckets.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([name, n]) => ({ name, count: n }));

    // RS Rotation context (Leading / Emerging + 1W delta)
    const tm = themeMeta.get(theme);
    const themeLayers = layersByTheme.get(theme) || [];
    const leadLayersN = themeLayers.filter((l) => l.st === "lead").length;
    const emergLayersN = themeLayers.filter((l) => l.st === "emerg").length;
    const rankNow = tm?.now ?? (themeLayers.length ? Math.round(Math.max(...themeLayers.map((l) => l.now ?? 0))) : null);
    const rankW1 = tm?.w1 ?? null;
    const rankDelta1w = rankNow != null && rankW1 != null ? Math.round(rankNow - rankW1) : null;
    const rotationStatus = tm?.st || (leadLayersN > 0 ? "lead" : emergLayersN > 0 ? "emerg" : "lag");

    // Collect fresh catalyst headlines from top cluster leaders
    const catalysts = [];
    const seenTitle = new Set();
    for (const x of list.slice(0, 8)) {
      for (const h of x.headlines || []) {
        if (!h?.title || seenTitle.has(h.title)) continue;
        seenTitle.add(h.title);
        catalysts.push({
          ticker: x.ticker,
          title: h.title,
          source: h.source || "",
          date: h.date || "",
          url: h.url || "",
        });
        if (catalysts.length >= 3) break;
      }
      if (catalysts.length >= 3) break;
    }
    const driverTags = detectCatalystDrivers(catalysts.map((c) => c.title));

    // Synthesize crisp factual "Why?" explanation
    const whyParts = [];
    if (subLayers.length) {
      const subStr = subLayers.slice(0, 2).map((sl) => `${sl.name} (${sl.count})`).join(" & ");
      whyParts.push(`Concentrated in ${subStr}`);
    }
    const rotTag = rotationStatus === "lead"
      ? `Leading rotation${rankNow != null ? ` (rank ${Math.round(rankNow)}${rankDelta1w != null ? `, ${rankDelta1w >= 0 ? "+" : ""}${rankDelta1w} 1W` : ""})` : ""}`
      : rotationStatus === "emerg"
        ? `Emerging rotation${rankNow != null ? ` (rank ${Math.round(rankNow)}${rankDelta1w != null ? `, ${rankDelta1w >= 0 ? "+" : ""}${rankDelta1w} 1W` : ""})` : ""}`
        : null;
    if (rotTag) whyParts.push(rotTag);

    const tapeStats = [];
    if (breakoutCount > 0) tapeStats.push(`${breakoutCount} breakout${breakoutCount > 1 ? "s" : ""}`);
    if (avgChg != null) tapeStats.push(`avg ${avgChg >= 0 ? "+" : ""}${avgChg.toFixed(1)}%`);
    if (avgZvr != null && avgZvr >= 1.2) tapeStats.push(`${avgZvr.toFixed(1)}× vol`);
    if (pp2Count >= 2) tapeStats.push(`${pp2Count} w/ multi-day PP accumulation`);
    else if (emaStackCount >= Math.ceil(count * 0.6)) tapeStats.push(`${emaStackCount}/${count} EMA-stacked`);
    if (tapeStats.length) whyParts.push(tapeStats.join(", "));

    if (driverTags.length) {
      whyParts.push(`News drivers: ${driverTags.join(", ")}`);
    }

    const aiWhy = externalWhyByTheme?.[theme] || externalWhyByTheme?.[theme.toLowerCase()] || null;
    const why = whyParts.join(" · ") + (whyParts.length ? "." : "");

    themeClusters.push({
      theme,
      count,
      aPlusCount,
      aCount,
      aPlusACount,
      pctGreen,
      avgChg,
      avgZvr,
      avgRs,
      avgScore,
      breakoutCount,
      pp2Count,
      emaStackCount,
      rotationStatus,
      rankNow: rankNow != null ? Math.round(rankNow) : null,
      rankDelta1w,
      subLayers,
      driverTags,
      catalysts,
      why,
      aiWhy,
      topTickers: list.slice(0, 5).map((x) => ({
        ticker: x.ticker,
        grade: x.grade,
        aPlusScore: x.aPlusScore,
        chg: x.chg,
        zvr: x.zvr,
        rs: x.rs,
        isBreakout: x.isBreakout,
      })),
    });
  }

  // Sort clusters by A+/A leadership concentration, then breakout breadth, then avg score & total count
  themeClusters.sort(
    (a, b) =>
      b.aPlusACount - a.aPlusACount ||
      b.breakoutCount - a.breakoutCount ||
      b.avgScore - a.avgScore ||
      b.count - a.count ||
      a.theme.localeCompare(b.theme)
  );

  // Prefer multi-stock clusters (>= 2 names) so "Why?" highlights real theme clustering; fall back to all if pool is tiny
  const multiClusters = themeClusters.filter((c) => c.count >= 2);
  const finalClusters = (multiClusters.length >= 2 ? multiClusters : themeClusters).slice(0, maxClusters);

  // Pick top 1–2 leaders from each of the top 6 clusters for on-demand fresh news enrichment
  const newsTargetSet = new Set();
  for (const r of graded.slice(0, 6)) newsTargetSet.add(r.ticker);
  for (const cl of finalClusters.slice(0, 6)) {
    for (const tk of cl.topTickers.slice(0, 2)) newsTargetSet.add(tk.ticker);
  }
  const newsTargets = [...newsTargetSet].slice(0, 14);

  return {
    totalMatched: graded.length,
    gradeCounts,
    leaders: graded.slice(0, maxLeaders),
    allGradedCount: graded.length,
    themeClusters: finalClusters,
    newsTargets,
  };
}
