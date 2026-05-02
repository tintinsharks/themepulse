// api/earnings-week.js — Vercel Serverless Function
// Returns the FMP earnings calendar for a specified date range. Authoritative
// source for ER date + BMO/AMC timing — pipeline's er_timing field can go
// stale between runs. Always use this for grid placement.
//
// Usage:
//   GET /api/earnings-week?from=2026-05-04&to=2026-05-08
//
// Response:
//   {
//     from, to,
//     events: [
//       { ticker, date, timing: "bmo"|"amc"|"", eps_estimate, revenue_estimate },
//       ...
//     ]
//   }

export const config = { maxDuration: 15 };

const FMP_BASE = "https://financialmodelingprep.com/stable";

// 1-hour TTL — earnings calendar updates frequently as companies confirm
const _cache = new Map();
const CACHE_MS = 60 * 60 * 1000;

const fetchJson = async (url, timeoutMs = 8000) => {
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
  res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1800");

  if (req.method === "OPTIONS") return res.status(200).end();

  const from = (req.query.from || "").trim();
  const to = (req.query.to || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ error: "from + to required, YYYY-MM-DD" });
  }

  const cacheKey = `${from}_${to}`;
  const cached = _cache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) {
    return res.status(200).json(cached.data);
  }

  const fmpKey = process.env.FMP_API_KEY;
  if (!fmpKey) {
    return res.status(500).json({ error: "FMP_API_KEY not configured" });
  }

  // Single FMP call returns every company reporting in this range
  const url = `${FMP_BASE}/earnings-calendar?from=${from}&to=${to}&apikey=${fmpKey}`;
  const raw = await fetchJson(url);
  if (!Array.isArray(raw)) {
    return res.status(502).json({ error: "FMP earnings-calendar returned no data", from, to });
  }

  // Normalize: FMP returns "bmo"/"amc"/"dmh" or null in `time`
  const events = raw
    .filter((e) => e?.symbol && e?.date)
    .map((e) => ({
      ticker: e.symbol.toUpperCase(),
      date: e.date,                   // YYYY-MM-DD
      timing: (e.time || "").toLowerCase(),   // bmo / amc / "" (during market = unusual)
      eps_estimate: e.epsEstimated ?? null,
      revenue_estimate: e.revenueEstimated ?? null,
      eps_actual: e.eps ?? null,
      revenue_actual: e.revenue ?? null,
    }));

  // Dedup by ticker (FMP sometimes lists multiple entries per quarter)
  const seen = new Set();
  const dedup = events.filter((e) => {
    const k = `${e.ticker}|${e.date}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const data = { from, to, events: dedup, count: dedup.length };
  _cache.set(cacheKey, { expiry: Date.now() + CACHE_MS, data });
  return res.status(200).json(data);
}
