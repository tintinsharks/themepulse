export default async function handler(req, res) {
  const ticker = (req.query.ticker || "AAPL").trim().toUpperCase();
  const fmpKey = process.env.FMP_API_KEY;
  const url = `https://financialmodelingprep.com/stable/financial-reports-dates?symbol=${ticker}&apikey=${fmpKey}`;
  try {
    const r = await fetch(url);
    const d = await r.json();
    return res.status(200).json({ url: url.replace(fmpKey, "***"), status: r.status, data: Array.isArray(d) ? d.slice(0, 6) : d });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
