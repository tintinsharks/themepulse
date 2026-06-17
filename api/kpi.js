// api/kpi.js — Vercel Serverless Function
//
// KPI-vs-EPS overlay for a single ticker: operating segments (revenue by
// product line) lined up quarter-by-quarter against the EPS/revenue surprise,
// so you can see whether the segment mix CONFIRMS the headline beat/miss.
//
//   GET /api/kpi?ticker=AMD          → product segments (default)
//   GET /api/kpi?ticker=AMD&view=geo → geographic segments
//
// Response:
//   { ticker, view, hasSegments, segNames[],
//     quarters: [ { label, period, date, ann,
//                   epsAct, epsEst, epsSurprisePct,
//                   revAct, revEst, revSurprisePct, revYoY,
//                   total, segs: { <name>: { rev, share, yoy } } } ],   // newest first
//     read: "<one-line synthesis>" }
//
// Data: FMP /stable revenue-product-segmentation + revenue-geographic-segmentation
//       + income-statement (revenue backbone, fiscalYear/period join key)
//       + earnings (epsActual/epsEstimated/revenueActual/revenueEstimated surprise).

export const config = { maxDuration: 15 };

const FMP_BASE = "https://financialmodelingprep.com/stable";

const fetchJson = async (url, timeoutMs = 8000) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
};

// 4h TTL, reused across warm invocations
const _cache = new Map();
const CACHE_MS = 4 * 60 * 60 * 1000;

const pct = (a, b) =>
  a != null && b != null && b !== 0 ? ((a - b) / Math.abs(b)) * 100 : null;

const qLabel = (fy, period) => `FY${String(fy).slice(-2)} ${period}`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=21600");

  const fmpKey = process.env.FMP_API_KEY;
  if (!fmpKey) return res.status(500).json({ error: "FMP_API_KEY not configured" });

  const ticker = (req.query.ticker || "").trim().toUpperCase();
  const view = req.query.view === "geo" ? "geo" : "product";
  if (!ticker || ticker.length > 10) return res.status(400).json({ error: "ticker required" });

  const cacheKey = `${ticker}|${view}`;
  const cached = _cache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) return res.status(200).json(cached.data);

  const segEndpoint =
    view === "geo" ? "revenue-geographic-segmentation" : "revenue-product-segmentation";

  const [seg, income, earnings] = await Promise.all([
    fetchJson(`${FMP_BASE}/${segEndpoint}?symbol=${ticker}&period=quarter&apikey=${fmpKey}`),
    fetchJson(`${FMP_BASE}/income-statement?symbol=${ticker}&period=quarter&limit=14&apikey=${fmpKey}`),
    fetchJson(`${FMP_BASE}/earnings?symbol=${ticker}&limit=24&apikey=${fmpKey}`),
  ]);

  // segments keyed by "fy|period" → { name: revenue }
  const segMap = {};
  if (Array.isArray(seg)) {
    seg.forEach((r) => {
      if (r?.fiscalYear && r?.period && r.data) segMap[`${r.fiscalYear}|${r.period}`] = r.data;
    });
  }

  // reported earnings (epsActual present), newest first
  const reported = Array.isArray(earnings)
    ? earnings
        .filter((e) => e?.date && e.epsActual != null)
        .sort((a, b) => (a.date < b.date ? 1 : -1))
    : [];

  // nearest announcement on/after a period-end date, within ~120 days
  const surpriseFor = (periodEnd) => {
    let best = null;
    for (const e of reported) {
      if (e.date < periodEnd) continue;
      const gap = (new Date(e.date) - new Date(periodEnd)) / 86400000;
      if (gap > 120) continue;
      if (!best || e.date < best.date) best = e;
    }
    return best;
  };

  const incRows = Array.isArray(income)
    ? income.filter((i) => i?.fiscalYear && i?.period && i?.date).sort((a, b) => (a.date < b.date ? 1 : -1))
    : [];

  // revenue by fy|period for YoY backbone
  const revMap = {};
  incRows.forEach((i) => (revMap[`${i.fiscalYear}|${i.period}`] = i.revenue));

  const quarters = incRows.slice(0, 8).map((i) => {
    const fy = i.fiscalYear,
      period = i.period;
    const segData = segMap[`${fy}|${period}`] || null;
    const prior = segMap[`${fy - 1}|${period}`] || null; // YoY
    const segs = {};
    if (segData) {
      for (const [name, rev] of Object.entries(segData)) {
        const total = Object.values(segData).reduce((s, v) => s + (v || 0), 0) || 1;
        const py = prior ? prior[name] : null;
        segs[name] = { rev, share: (rev / total) * 100, yoy: pct(rev, py) };
      }
    }
    const sp = surpriseFor(i.date);
    return {
      label: qLabel(fy, period),
      period,
      date: i.date,
      ann: sp?.date || null,
      epsAct: sp?.epsActual ?? null,
      epsEst: sp?.epsEstimated ?? null,
      epsSurprisePct: sp ? pct(sp.epsActual, sp.epsEstimated) : null,
      revAct: sp?.revenueActual ?? i.revenue ?? null,
      revEst: sp?.revenueEstimated ?? null,
      revSurprisePct: sp ? pct(sp.revenueActual, sp.revenueEstimated) : null,
      revYoY: pct(i.revenue, revMap[`${fy - 1}|${period}`]),
      total: i.revenue ?? null,
      segs,
    };
  });

  const hasSegments = quarters.some((q) => Object.keys(q.segs).length);

  // segNames ordered by latest-quarter size desc
  let segNames = [];
  const latestWithSegs = quarters.find((q) => Object.keys(q.segs).length);
  if (latestWithSegs) {
    segNames = Object.entries(latestWithSegs.segs)
      .sort((a, b) => b[1].rev - a[1].rev)
      .map(([n]) => n);
  }

  // one-line synthesis: top segment, its YoY, accel vs prior quarter, vs the beat
  let read = null;
  if (hasSegments && quarters.length >= 2 && segNames.length) {
    const lead = segNames[0];
    const q0 = quarters[0],
      q1 = quarters[1];
    const yoy0 = q0.segs[lead]?.yoy,
      yoy1 = q1.segs[lead]?.yoy;
    const eps = q0.epsSurprisePct;
    if (yoy0 != null) {
      const accel = yoy1 != null ? (yoy0 > yoy1 ? "accelerating" : yoy0 < yoy1 ? "decelerating" : "flat") : null;
      const trend = accel ? `, ${accel} from ${yoy1.toFixed(0)}%` : "";
      let verdict = "";
      if (eps != null) {
        const beat = eps >= 0;
        const strong = yoy0 >= 20 && (accel ? accel === "accelerating" : true);
        verdict =
          beat && strong
            ? " — confirms the beat"
            : beat && !strong
            ? " — beat not led by the core segment"
            : !beat && strong
            ? " — segment strong despite the miss"
            : " — segment soft, in line with the miss";
      }
      read = `${lead} ${yoy0 >= 0 ? "+" : ""}${yoy0.toFixed(0)}% YoY${trend}${verdict}`;
    }
  } else if (quarters.length && quarters[0].epsSurprisePct != null) {
    const e = quarters[0].epsSurprisePct;
    read = `No segment breakdown — EPS ${e >= 0 ? "beat" : "missed"} by ${Math.abs(e).toFixed(0)}% last quarter`;
  }

  const data = { ticker, view, hasSegments, segNames, quarters, read };
  _cache.set(cacheKey, { expiry: Date.now() + CACHE_MS, data });
  return res.status(200).json(data);
}
