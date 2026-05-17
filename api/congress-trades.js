// api/congress-trades.js — Proxy for FMP senate + house trades
// GET /api/congress-trades?symbol=AVGO

export const config = { maxDuration: 10 };

const FMP = "https://financialmodelingprep.com/stable";

export default async function handler(req, res) {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol required" });

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "FMP_API_KEY not set" });

  const [senate, house] = await Promise.all([
    fetch(`${FMP}/senate-trades?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`).then(r => r.ok ? r.json() : []).catch(() => []),
    fetch(`${FMP}/house-trades?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`).then(r => r.ok ? r.json() : []).catch(() => []),
  ]);

  const all = [
    ...(Array.isArray(senate) ? senate : []).map(t => ({ ...t, chamber: "S" })),
    ...(Array.isArray(house) ? house : []).map(t => ({ ...t, chamber: "H" })),
  ].sort((a, b) => (b.transactionDate || "").localeCompare(a.transactionDate || "")).slice(0, 30);

  res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=43200");
  return res.status(200).json({ symbol, trades: all });
}
