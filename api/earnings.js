// api/earnings.js — Vercel Serverless Function
// Returns earnings detail for a single ticker:
//   · last 4-8 quarters of beat/miss (EPS estimate, EPS actual, surprise %)
//   · revenue actual + estimate (when available)
//   · upcoming earnings date (next confirmed event)
//
// Usage:
//   GET /api/earnings?ticker=NVDA
//
// Response:
//   {
//     ticker: "NVDA",
//     next: { date, timing, days_until } | null,
//     history: [
//       { date, period, eps_actual, eps_estimate, eps_surprise_pct,
//         revenue_actual, revenue_estimate, revenue_surprise_pct },
//       ...
//     ]
//   }

export const config = { maxDuration: 15 };

const FMP_BASE = "https://financialmodelingprep.com/stable";

// In-memory cache so repeated clicks on the same ticker don't burn FMP calls.
// 4-hour TTL: earnings data only changes when a stock reports.
const _cache = new Map();
const CACHE_MS = 4 * 60 * 60 * 1000;

const fetchJson = async (url, timeoutMs = 6000) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900");

  if (req.method === "OPTIONS") return res.status(200).end();

  const ticker = (req.query.ticker || "").trim().toUpperCase();
  if (!ticker || ticker.length > 10) {
    return res.status(400).json({ error: "ticker param required" });
  }

  // Cache check
  const cached = _cache.get(ticker);
  if (cached && cached.expiry > Date.now()) {
    return res.status(200).json(cached.data);
  }

  const fmpKey = process.env.FMP_API_KEY;
  if (!fmpKey) {
    return res.status(500).json({ error: "FMP_API_KEY not configured" });
  }

  // 3 parallel fetches:
  //   1. /stable/earnings-surprises  — quarterly EPS estimate + actual + date
  //   2. /stable/income-statement    — quarterly revenue actuals
  //   3. /stable/earnings-calendar   — next upcoming ER (filter by ticker)
  // Plus optional /stable/analyst-estimates for revenue forecasts on history.
  const [surprises, income, calendar, analyst, histCal] = await Promise.all([
    fetchJson(`${FMP_BASE}/earnings-surprises?symbol=${ticker}&apikey=${fmpKey}`),
    fetchJson(`${FMP_BASE}/income-statement?symbol=${ticker}&period=quarter&limit=8&apikey=${fmpKey}`),
    fetchJson(`${FMP_BASE}/earnings-calendar?symbol=${ticker}&apikey=${fmpKey}`),
    fetchJson(`${FMP_BASE}/analyst-estimates?symbol=${ticker}&period=quarter&apikey=${fmpKey}`),
    fetchJson(`${FMP_BASE}/historical/earning_calendar/${ticker}?apikey=${fmpKey}`),
  ]);

  // Build history map by date so revenue + EPS can be merged
  const byDate = {};   // dateStr → { eps_actual, eps_estimate, revenue_actual, revenue_estimate, period }

  if (Array.isArray(surprises)) {
    surprises.slice(0, 8).forEach((s) => {
      const date = s.date || s.fiscalDateEnding;
      if (!date) return;
      byDate[date] = byDate[date] || { date };
      byDate[date].eps_actual = s.epsActual ?? s.eps ?? null;
      byDate[date].eps_estimate = s.epsEstimated ?? s.estimatedEps ?? null;
    });
  }
  if (Array.isArray(income)) {
    income.slice(0, 8).forEach((i) => {
      const date = i.date || i.fiscalDateEnding;
      if (!date) return;
      byDate[date] = byDate[date] || { date };
      byDate[date].revenue_actual = i.revenue ?? null;
      byDate[date].period = i.period || null;
    });
  }
  if (Array.isArray(analyst)) {
    analyst.slice(0, 12).forEach((a) => {
      const date = a.date || a.fiscalDateEnding;
      if (!date) return;
      // Only enrich existing dates; don't add forecast-only future periods
      if (byDate[date]) {
        byDate[date].revenue_estimate = a.revenueAvg ?? a.estimatedRevenueAvg ?? null;
      }
    });
  }

  // Map fiscal quarter end → actual report date from historical earnings calendar
  const reportDateMap = {};
  if (Array.isArray(histCal)) {
    histCal.forEach((e) => {
      if (e.date && e.fiscalDateEnding) {
        reportDateMap[e.fiscalDateEnding] = e.date;
      }
    });
  }

  // Convert to sorted descending array, compute surprise %
  const history = Object.values(byDate)
    .filter((row) => row.eps_actual != null || row.revenue_actual != null)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 8)
    .map((row) => {
      const epsSurprise = row.eps_estimate != null && row.eps_estimate !== 0
        ? ((row.eps_actual - row.eps_estimate) / Math.abs(row.eps_estimate)) * 100
        : null;
      const revSurprise = row.revenue_estimate != null && row.revenue_estimate !== 0
        ? ((row.revenue_actual - row.revenue_estimate) / Math.abs(row.revenue_estimate)) * 100
        : null;
      return {
        date: row.date,
        report_date: reportDateMap[row.date] || null,
        period: row.period,
        eps_actual: row.eps_actual ?? null,
        eps_estimate: row.eps_estimate ?? null,
        eps_surprise_pct: epsSurprise,
        revenue_actual: row.revenue_actual ?? null,
        revenue_estimate: row.revenue_estimate ?? null,
        revenue_surprise_pct: revSurprise,
      };
    });

  // Next upcoming ER from calendar — pick the first future date
  let next = null;
  if (Array.isArray(calendar)) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const future = calendar
      .filter((c) => c.date && new Date(c.date) >= today)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    if (future.length > 0) {
      const f = future[0];
      const dt = new Date(f.date);
      const days = Math.round((dt - today) / 86400000);
      next = {
        date: f.date,
        timing: f.time || null,            // FMP returns "amc"/"bmo" sometimes
        days_until: days,
        eps_estimate: f.epsEstimated ?? null,
        revenue_estimate: f.revenueEstimated ?? null,
      };
    }
  }

  const data = { ticker, next, history };
  _cache.set(ticker, { expiry: Date.now() + CACHE_MS, data });
  return res.status(200).json(data);
}
