// api/earnings.js — Vercel Serverless Function
//
// Routes by query params:
//   GET /api/earnings?ticker=NVDA          → single-ticker earnings detail
//   GET /api/earnings?from=YYYY-MM-DD&to=YYYY-MM-DD  → earnings calendar for date range
//
// Single-ticker response:
//   { ticker, next: { date, timing, days_until, eps_estimate, revenue_estimate },
//     history: [{ date, period, eps_actual, eps_estimate, eps_surprise_pct,
//                 revenue_actual, revenue_estimate, revenue_surprise_pct }],
//     news: [{ title, url, source, date }] }
//
// Date-range response:
//   { from, to, events: [{ ticker, date, timing, eps_estimate, revenue_estimate,
//                           eps_actual, revenue_actual }], count }

export const config = { maxDuration: 15 };

const FMP_BASE = "https://financialmodelingprep.com/stable";

// ── shared helpers ────────────────────────────────────────────────────────────

const fetchJson = async (url, timeoutMs = 8000) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
};

// ── per-function caches (module-level, reused across warm invocations) ────────

// Single-ticker: 4h TTL
const _tickerCache = new Map();
const TICKER_CACHE_MS = 4 * 60 * 60 * 1000;

// Date-range: 1h TTL
const _weekCache = new Map();
const WEEK_CACHE_MS = 60 * 60 * 1000;

// ── main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const fmpKey = process.env.FMP_API_KEY;
  if (!fmpKey) return res.status(500).json({ error: "FMP_API_KEY not configured" });

  const { ticker: tickerRaw, from, to } = req.query;

  // ── Route: date range calendar ──────────────────────────────────────────────
  if (from || to) {
    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1800");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: "from + to required, YYYY-MM-DD" });
    }

    const cacheKey = `${from}_${to}`;
    const cached = _weekCache.get(cacheKey);
    if (cached && cached.expiry > Date.now()) return res.status(200).json(cached.data);

    const url = `${FMP_BASE}/earnings-calendar?from=${from}&to=${to}&apikey=${fmpKey}`;
    const raw = await fetchJson(url);
    if (!Array.isArray(raw)) {
      return res.status(502).json({ error: "FMP earnings-calendar returned no data", from, to });
    }

    const events = raw
      .filter((e) => e?.symbol && e?.date)
      .map((e) => ({
        ticker: e.symbol.toUpperCase(),
        date: e.date,
        timing: (e.time || "").toLowerCase(),
        eps_estimate: e.epsEstimated ?? null,
        revenue_estimate: e.revenueEstimated ?? null,
        eps_actual: e.eps ?? null,
        revenue_actual: e.revenue ?? null,
      }));

    const seen = new Set();
    const dedup = events.filter((e) => {
      const k = `${e.ticker}|${e.date}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const data = { from, to, events: dedup, count: dedup.length };
    _weekCache.set(cacheKey, { expiry: Date.now() + WEEK_CACHE_MS, data });
    return res.status(200).json(data);
  }

  // ── Route: single ticker ────────────────────────────────────────────────────
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900");

  const ticker = (tickerRaw || "").trim().toUpperCase();
  if (!ticker || ticker.length > 10) {
    return res.status(400).json({ error: "ticker or from+to params required" });
  }

  const cached = _tickerCache.get(ticker);
  if (cached && cached.expiry > Date.now()) return res.status(200).json(cached.data);

  // /stable/earnings has actual + estimated EPS AND revenue per announcement
  // date (the old earnings-surprises endpoint 404s on this key). EOD closes
  // around each date give the price reactions.
  const eodFrom = new Date(Date.now() - 3.2 * 365 * 86400000).toISOString().split("T")[0];
  const [earnings, calendar, newsRaw, eodRaw, incomeRaw] = await Promise.all([
    fetchJson(`${FMP_BASE}/earnings?symbol=${ticker}&limit=16&apikey=${fmpKey}`),
    fetchJson(`${FMP_BASE}/earnings-calendar?symbol=${ticker}&apikey=${fmpKey}`),
    fetchJson(`${FMP_BASE}/news/stock?symbols=${ticker}&page=0&limit=10&apikey=${fmpKey}`),
    fetchJson(`${FMP_BASE}/historical-price-eod/full?symbol=${ticker}&from=${eodFrom}&apikey=${fmpKey}`),
    fetchJson(`${FMP_BASE}/income-statement?symbol=${ticker}&period=quarter&limit=16&apikey=${fmpKey}`),
  ]);

  // Quarterly net profit margin, matched to each report by fiscal-period end
  // (income-statement dates are quarter ends, ~4-8 weeks before the report).
  const incomeQ = (Array.isArray(incomeRaw) ? incomeRaw : [])
    .filter((i) => i && i.date && i.revenue)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const incomeFor = (reportDate) => {
    for (const i of incomeQ) {
      if (i.date < reportDate) {
        const gapDays = (new Date(reportDate) - new Date(i.date)) / 86400000;
        return gapDays > 100 ? null : i; // stale — no matching quarter filed
      }
    }
    return null;
  };

  const bars = (Array.isArray(eodRaw) ? eodRaw : eodRaw?.historical || [])
    .filter((b) => b && b.date && b.close != null)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const dates = bars.map((b) => b.date);
  const closes = bars.map((b) => b.close);
  const idxOnOrAfter = (d) => {
    for (let i = 0; i < dates.length; i++) if (dates[i] >= d) return i;
    return -1;
  };
  const pctc = (a, b) => (a != null && b != null && b !== 0 ? +(((a - b) / b) * 100).toFixed(2) : null);

  const reported = (Array.isArray(earnings) ? earnings : [])
    .filter((q) => q && q.date && q.epsActual != null)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const history = reported
    .slice(0, 8)
    .map((q, qi) => {
      // YoY growth: same fiscal quarter a year ago = 4 reports earlier
      const yr = reported[qi + 4];
      const epsYoy = yr && yr.epsActual != null && Math.abs(yr.epsActual) > 1e-9
        ? ((q.epsActual - yr.epsActual) / Math.abs(yr.epsActual)) * 100
        : null;
      const revYoy = yr && q.revenueActual != null && yr.revenueActual
        ? ((q.revenueActual - yr.revenueActual) / Math.abs(yr.revenueActual)) * 100
        : null;
      const epsSurprise =
        q.epsEstimated != null && Math.abs(q.epsEstimated) > 1e-9
          ? ((q.epsActual - q.epsEstimated) / Math.abs(q.epsEstimated)) * 100
          : null;
      const revSurprise =
        q.revenueActual != null && q.revenueEstimated
          ? ((q.revenueActual - q.revenueEstimated) / Math.abs(q.revenueEstimated)) * 100
          : null;
      // Reaction: /stable/earnings carries no BMO/AMC flag, so take the
      // larger-|%| of the ER-day move vs the next session's move as the
      // announcement day. day1 = that close vs prior close; day10 = close 10
      // sessions after the pre-ER close vs the pre-ER close (incl. drift).
      let day1 = null, day10 = null;
      const i = idxOnOrAfter(q.date);
      if (i > 0) {
        const onDay = pctc(closes[i], closes[i - 1]);
        const nextDay = i + 1 < closes.length ? pctc(closes[i + 1], closes[i]) : null;
        const r = nextDay != null && Math.abs(nextDay) > Math.abs(onDay ?? 0) ? i + 1 : i;
        day1 = pctc(closes[r], closes[r - 1]);
        if (r - 1 + 10 < closes.length) day10 = pctc(closes[r - 1 + 10], closes[r - 1]);
      }
      return {
        date: q.date,
        period: null,
        eps_actual: q.epsActual ?? null,
        eps_estimate: q.epsEstimated ?? null,
        eps_surprise_pct: epsSurprise,
        revenue_actual: q.revenueActual ?? null,
        revenue_estimate: q.revenueEstimated ?? null,
        revenue_surprise_pct: revSurprise,
        eps_yoy_pct: epsYoy,
        revenue_yoy_pct: revYoy,
        // Fiscal label from the matching income-statement quarter (Q3-26 =
        // the company's own fiscal naming, matching the chart markers) +
        // ADJUSTED net margin: street-basis EPS × diluted shares / revenue,
        // so one-time GAAP items can't fake margin acceleration (WDC's 96%
        // GAAP quarter reads ~31% adjusted). GAAP fallback if shares missing.
        ...(() => {
          const inc = incomeFor(q.date);
          const shares = inc?.weightedAverageShsOutDil || inc?.weightedAverageShsOut;
          const adjMargin = shares && q.revenueActual
            ? +(((q.epsActual * shares) / q.revenueActual) * 100).toFixed(2)
            : inc?.netIncome != null && inc?.revenue ? +((inc.netIncome / inc.revenue) * 100).toFixed(2) : null;
          const fy = inc?.fiscalYear ?? inc?.calendarYear;
          return {
            fiscal_label: inc?.period && fy ? `${inc.period}-${String(fy).slice(2)}` : null,
            net_margin_pct: adjMargin,
            gross_margin_pct: inc?.grossProfit != null && inc?.revenue ? +((inc.grossProfit / inc.revenue) * 100).toFixed(2) : null,
          };
        })(),
        day1_pct: day1,
        day10_pct: day10,
      };
    });

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
        timing: f.time || null,
        days_until: days,
        eps_estimate: f.epsEstimated ?? null,
        revenue_estimate: f.revenueEstimated ?? null,
      };
    }
  }

  const news = Array.isArray(newsRaw)
    ? newsRaw.slice(0, 10).map((a) => ({
        title: a.title || "",
        url: a.url || "",
        source: a.site || "",
        date: a.publishedDate || a.date || "",
      }))
    : [];

  const data = { ticker, next, history, news };
  _tickerCache.set(ticker, { expiry: Date.now() + TICKER_CACHE_MS, data });
  return res.status(200).json(data);
}
