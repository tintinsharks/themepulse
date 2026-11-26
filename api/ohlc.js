// Vercel serverless function: /api/ohlc?ticker=AAPL&interval=1d
// Also supports batch mode: /api/ohlc?tickers=NVDA,DKS&interval=30m (max 24 tickers)
// Uses FMP (Financial Modeling Prep). Yahoo's chart API blocks Vercel
// datacenter egress, so this routes through FMP instead.
// Supported intervals: 1d (1-year EOD), 1wk, 1m/5m/15m (~1 day), 30m (~5 days).

import { requireAuth } from "./auth.js";

const FMP_BASE = "https://financialmodelingprep.com/stable";
const BATCH_MAX_TICKERS = 24;
const BATCH_CONCURRENCY = 6;
const BATCH_CACHE_TTL_MS = 60_000;
const BATCH_CACHE_MAX_ENTRIES = 500;

// Small module-level warm cache keyed by `${interval}:${TICKER}`.
const batchCache = new Map();

// lookback = calendar days requested from FMP. Without from/to FMP returns its
// full default range (a month+ of bars — ~1MB per 1-min request) only for us
// to slice the last N bars; bounding the window cuts the transfer ~10x.
const INTRADAY = {
  "1m": { path: "1min", bars: 390, lookback: 4 },
  "5m": { path: "5min", bars: 78, lookback: 4 },
  "15m": { path: "15min", bars: 26, lookback: 6 },
  "30m": { path: "30min", bars: 65, lookback: 10, chartBars: 310, chartLookback: 36 },
};

// FMP intraday timestamps are "YYYY-MM-DD HH:MM:SS" in America/New_York
// with no TZ suffix. Convert to a real unix second value by computing the
// ET offset (EST vs EDT) for that specific instant.
function etToUnixSeconds(dateStr) {
  const asIfUtc = new Date(dateStr.replace(" ", "T") + "Z");
  if (isNaN(asIfUtc.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).formatToParts(asIfUtc);
  const tz = parts.find((p) => p.type === "timeZoneName")?.value;
  const offsetHours = tz === "EDT" ? -4 : -5;
  return Math.floor(asIfUtc.getTime() / 1000) - offsetHours * 3600;
}

function round2(v) {
  return v != null && !isNaN(v) ? Math.round(v * 100) / 100 : null;
}

function getCached(key, nowMs) {
  const entry = batchCache.get(key);
  if (!entry) return null;
  if (nowMs - entry.ts > BATCH_CACHE_TTL_MS) {
    batchCache.delete(key);
    return null;
  }
  return entry.bars;
}

function setCached(key, bars, nowMs) {
  if (batchCache.size >= BATCH_CACHE_MAX_ENTRIES) {
    const oldestKey = batchCache.keys().next().value;
    if (oldestKey !== undefined) batchCache.delete(oldestKey);
  }
  batchCache.set(key, { ts: nowMs, bars });
}

async function fetchOhlcBars(symbol, ival, apiKey, { batch = false } = {}) {
  const intraSpec = INTRADAY[ival];
  const isIntraday = Boolean(intraSpec);
  const isWeekly = ival === "1wk";

  let ohlc;
  if (isIntraday) {
    const now = new Date();
    const lbDays = batch ? intraSpec.lookback : (intraSpec.chartLookback ?? intraSpec.lookback);
    const maxBars = batch ? intraSpec.bars : (intraSpec.chartBars ?? intraSpec.bars);
    const fromStr = new Date(now.getTime() - lbDays * 24 * 3600 * 1000).toISOString().split("T")[0];
    const toStr = now.toISOString().split("T")[0];
    const url = `${FMP_BASE}/historical-chart/${intraSpec.path}?symbol=${encodeURIComponent(symbol)}&from=${fromStr}&to=${toStr}&apikey=${apiKey}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) throw new Error(`FMP HTTP ${resp.status}`);
    const data = await resp.json();
    if (!Array.isArray(data)) throw new Error("No data from FMP");
    // FMP returns newest-first. Take the most-recent N bars then reverse
    // so the client gets oldest → newest.
    ohlc = data
      .slice(0, maxBars)
      .reverse()
      .map((c) => ({
        time: etToUnixSeconds(c.date),
        open: round2(c.open),
        high: round2(c.high),
        low: round2(c.low),
        close: round2(c.close),
        volume: Number(c.volume) || 0,
      }))
      .filter((c) => c.time != null && c.open != null && c.close != null);
  } else {
    const now = new Date();
    const lookbackDays = isWeekly ? 1825 : 900;
    const fromDate = new Date(now.getTime() - lookbackDays * 24 * 3600 * 1000);
    const fromStr = fromDate.toISOString().split("T")[0];
    const toStr = now.toISOString().split("T")[0];
    const url = `${FMP_BASE}/historical-price-eod/full?symbol=${encodeURIComponent(symbol)}&from=${fromStr}&to=${toStr}&apikey=${apiKey}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) throw new Error(`FMP HTTP ${resp.status}`);
    const data = await resp.json();
    const rows = Array.isArray(data) ? data : data?.historical;
    if (!Array.isArray(rows)) throw new Error("No data from FMP");
    ohlc = rows
      .slice()
      .reverse()
      .map((c) => ({
        time: Math.floor(new Date(c.date + "T00:00:00Z").getTime() / 1000),
        date: c.date,
        open: round2(c.open),
        high: round2(c.high),
        low: round2(c.low),
        close: round2(c.close),
        volume: Number(c.volume) || 0,
      }))
      .filter((c) => c.open != null && c.close != null);
  }

  if (isWeekly && ohlc.length) {
    const weeks = [];
    let cur = null;
    for (const bar of ohlc) {
      const d = new Date(bar.date + "T00:00:00Z");
      const day = d.getUTCDay();
      const mon = d.getTime() - day * 86400000;
      if (!cur || cur._mon !== mon) {
        if (cur) weeks.push(cur);
        cur = { ...bar, _mon: mon };
      } else {
        cur.high = Math.max(cur.high, bar.high);
        cur.low = Math.min(cur.low, bar.low);
        cur.close = bar.close;
        cur.volume += bar.volume;
        cur.date = bar.date;
        cur.time = bar.time;
      }
    }
    if (cur) weeks.push(cur);
    ohlc = weeks.map(({ _mon, ...rest }) => rest);
  }

  return ohlc;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireAuth(req, res)) return;

  const { ticker, tickers, interval } = req.query || {};

  // Batch mode: /api/ohlc?tickers=NVDA,DKS,...&interval=30m
  if (tickers !== undefined && String(tickers).trim() !== "") {
    const seen = new Set();
    const list = [];
    for (const raw of String(tickers).split(",")) {
      const sym = raw.trim().toUpperCase();
      if (!sym || seen.has(sym)) continue;
      if (!/^[A-Z0-9.-]{1,12}$/.test(sym)) continue;
      seen.add(sym);
      list.push(sym);
      if (list.length >= BATCH_MAX_TICKERS) break;
    }
    if (list.length === 0) {
      return res.status(400).json({ ok: false, error: "Missing tickers" });
    }

    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ ok: false, error: "FMP_API_KEY not configured" });
    }

    const ival =
      interval && INTRADAY[interval]
        ? interval
        : interval === "1wk"
          ? "1wk"
          : interval === "1d"
            ? "1d"
            : "30m";

    const items = {};
    const missing = [];
    const nowMs = Date.now();

    for (const sym of list) {
      const cached = getCached(`${ival}:${sym}`, nowMs);
      if (cached) {
        items[sym] = cached;
      } else {
        missing.push(sym);
      }
    }

    if (missing.length > 0) {
      let cursor = 0;
      const workerCount = Math.min(BATCH_CONCURRENCY, missing.length);
      const workers = Array.from({ length: workerCount }, async () => {
        while (cursor < missing.length) {
          const sym = missing[cursor++];
          try {
            const bars = await fetchOhlcBars(sym, ival, apiKey, { batch: true });
            setCached(`${ival}:${sym}`, bars, Date.now());
            items[sym] = bars;
          } catch {
            // Never fail the whole batch if one ticker errors — omit failed ticker.
          }
        }
      });
      await Promise.all(workers);
    }

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.json({ ok: true, interval: ival, items });
  }

  if (!ticker) return res.status(400).json({ ok: false, error: "Missing ticker" });

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: "FMP_API_KEY not configured" });
  }

  const intraSpec = interval && INTRADAY[interval];
  const isIntraday = Boolean(intraSpec);
  const isWeekly = interval === "1wk";
  const ival = isIntraday ? interval : isWeekly ? "1wk" : "1d";

  try {
    const ohlc = await fetchOhlcBars(ticker, ival, apiKey);
    const cacheMaxAge = isIntraday ? 30 : 300;
    res.setHeader("Cache-Control", `private, max-age=${cacheMaxAge}`);
    return res.json({ ok: true, ticker: ticker.toUpperCase(), ohlc, interval: ival });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
