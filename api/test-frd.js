export default async function handler(req, res) {
  const ticker = (req.query.ticker || "AAPL").trim().toUpperCase();
  const fmpKey = process.env.FMP_API_KEY;
  const base = "https://financialmodelingprep.com/stable";
  const endpoints = [
    { name: "financial-reports-dates", url: `${base}/financial-reports-dates?symbol=${ticker}&apikey=${fmpKey}` },
    { name: "earning-calendar-confirmed", url: `${base}/earning-calendar-confirmed?symbol=${ticker}&apikey=${fmpKey}` },
  ];
  const results = {};
  for (const ep of endpoints) {
    try {
      const r = await fetch(ep.url);
      const d = await r.json();
      results[ep.name] = { status: r.status, data: Array.isArray(d) ? d.slice(0, 4) : d };
    } catch (e) {
      results[ep.name] = { error: e.message };
    }
  }
  return res.status(200).json(results);
}
