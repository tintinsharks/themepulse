// api/ohlc.js — Vercel serverless function to proxy FMP historical price requests
// Keeps API key server-side, never exposed to client

export default async function handler(req, res) {
  const { symbol, from, to } = req.query;
  
  if (!symbol) {
    return res.status(400).json({ error: "symbol required" });
  }

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "FMP_API_KEY not configured" });
  }

  try {
    const url = `https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${encodeURIComponent(symbol)}&from=${from || ""}&to=${to || ""}&apikey=${apiKey}`;
    const response = await fetch(url, { headers: { "Accept": "application/json" } });
    
    if (!response.ok) {
      return res.status(response.status).json({ error: `FMP returned ${response.status}` });
    }

    const data = await response.json();
    
    // Cache for 5 minutes (CDN) + 1 hour (browser)
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=3600");
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
