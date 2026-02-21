// Vercel serverless function: /api/ohlc?ticker=AAPL
// Place in: themepulse/api/ohlc.js
// Uses Yahoo Finance chart API (free, no key needed)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ ok: false, error: "Missing ticker" });

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d&includePrePost=false`;
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
      const d = new Date(ts * 1000);
      const date = d.toISOString().split("T")[0];
      return {
        date,
        open: quote.open?.[i] != null ? Math.round(quote.open[i] * 100) / 100 : null,
        high: quote.high?.[i] != null ? Math.round(quote.high[i] * 100) / 100 : null,
        low: quote.low?.[i] != null ? Math.round(quote.low[i] * 100) / 100 : null,
        close: quote.close?.[i] != null ? Math.round(quote.close[i] * 100) / 100 : null,
        volume: quote.volume?.[i] || 0,
      };
    }).filter(c => c.open != null && c.close != null);

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.json({ ok: true, ticker: ticker.toUpperCase(), ohlc });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
