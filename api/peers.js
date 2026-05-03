// Vercel serverless function: /api/peers?ticker=SNDK
// Returns FMP Stock Peer Comparison — same exchange, sector, and market cap range.
// Cached 1 hour (peers rarely change).

const FMP_BASE = "https://financialmodelingprep.com/stable";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const ticker = (req.query.ticker || "").trim().toUpperCase();
  if (!ticker) return res.status(400).json({ ok: false, error: "Missing ticker" });

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return res.status(500).json({ ok: false, error: "FMP_API_KEY not configured" });

  try {
    const url = `${FMP_BASE}/stock-peers?symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`FMP HTTP ${resp.status}`);
    const data = await resp.json();

    const peers = Array.isArray(data) && data[0]?.peersList
      ? data[0].peersList.filter(p => p && p !== ticker)
      : [];

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");
    return res.json({ ok: true, ticker, peers });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
