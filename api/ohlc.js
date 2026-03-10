// Vercel serverless function: /api/ohlc?ticker=AAPL&interval=1d
// Uses Yahoo Finance chart API (free, no key needed)
// Supports: interval=1d (default, 1-year range) or interval=5m (1-day range, intraday)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { ticker, interval } = req.query;
  if (!ticker) return res.status(400).json({ ok: false, error: "Missing ticker" });

  const isIntraday = interval === "5m" || interval === "1m" || interval === "15m" || interval === "30m";
  const range = isIntraday ? (interval === "30m" ? "5d" : "1d") : "1y";
  const ival = isIntraday ? interval : "1d";

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${ival}&includePrePost=${isIntraday}`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
    });
    if (!resp.ok) throw new Error(`Yahoo HTTP ${resp.status}`);
    const data = await resp.json();

    const result = data?.chart?.result?.[0];
    if (!result || !result.timestamp) throw new Error("No data from Yahoo");

    const timestamps = result.timestamp;
    const quote = result.indicators?.quote?.[0];
    if (!quote) throw new Error("No quote data");

    const ohlc = timestamps.map((ts, i) => {
      return {
        time: ts,  // Unix timestamp (seconds) — lightweight-charts uses this directly
        date: isIntraday ? undefined : new Date(ts * 1000).toISOString().split("T")[0],
        open: quote.open?.[i] != null ? Math.round(quote.open[i] * 100) / 100 : null,
        high: quote.high?.[i] != null ? Math.round(quote.high[i] * 100) / 100 : null,
        low: quote.low?.[i] != null ? Math.round(quote.low[i] * 100) / 100 : null,
        close: quote.close?.[i] != null ? Math.round(quote.close[i] * 100) / 100 : null,
        volume: quote.volume?.[i] || 0,
      };
    }).filter(c => c.open != null && c.close != null);

    // Shorter cache for intraday data
    const cacheMaxAge = isIntraday ? 30 : 300;
    const cacheStale = isIntraday ? 60 : 600;
    res.setHeader("Cache-Control", `s-maxage=${cacheMaxAge}, stale-while-revalidate=${cacheStale}`);
    return res.json({ ok: true, ticker: ticker.toUpperCase(), ohlc, interval: ival });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
