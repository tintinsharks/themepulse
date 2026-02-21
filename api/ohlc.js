// Vercel serverless function: /api/ohlc?ticker=AAPL
// Place in: themepulse/api/ohlc.js
// Uses FMP (Financial Modeling Prep) API for OHLC data
// Requires env var: FMP_API_KEY

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ ok: false, error: "Missing ticker" });

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return res.status(500).json({ ok: false, error: "FMP_API_KEY not configured" });

  try {
    // FMP historical daily prices — returns up to 5 years by default
    const url = `https://financialmodelingprep.com/api/v3/historical-price-full/${encodeURIComponent(ticker)}?apikey=${apiKey}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`FMP HTTP ${resp.status}`);
    const data = await resp.json();

    if (!data?.historical || data.historical.length === 0) {
      throw new Error("No historical data from FMP");
    }

    // FMP returns newest first, Lightweight Charts needs oldest first
    // Take last 250 trading days (~1 year)
    const ohlc = data.historical
      .slice(0, 250)
      .reverse()
      .map(d => ({
        date: d.date,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
        volume: d.volume || 0,
      }));

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.json({ ok: true, ticker: ticker.toUpperCase(), ohlc });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
