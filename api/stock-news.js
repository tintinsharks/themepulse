export const config = { maxDuration: 10 };

const FMP_BASE = "https://financialmodelingprep.com/stable";

const _cache = new Map();
const CACHE_MS = 30 * 60 * 1000;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900");

  if (req.method === "OPTIONS") return res.status(200).end();

  const ticker = (req.query.ticker || "").trim().toUpperCase();
  if (!ticker || ticker.length > 10) {
    return res.status(400).json({ error: "ticker param required" });
  }

  const cached = _cache.get(ticker);
  if (cached && cached.expiry > Date.now()) {
    return res.status(200).json(cached.data);
  }

  const fmpKey = process.env.FMP_API_KEY;
  if (!fmpKey) {
    return res.status(500).json({ error: "FMP_API_KEY not configured" });
  }

  try {
    const url = `${FMP_BASE}/news/stock-latest?symbol=${ticker}&page=0&limit=10&apikey=${fmpKey}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return res.status(502).json({ error: "FMP news fetch failed" });
    const raw = await r.json();

    const articles = (Array.isArray(raw) ? raw : []).map((a) => ({
      title: a.title || "",
      url: a.url || "",
      source: a.source || "",
      date: a.publishedDate || a.date || "",
    }));

    const data = { ticker, articles };
    _cache.set(ticker, { expiry: Date.now() + CACHE_MS, data });
    return res.status(200).json(data);
  } catch {
    return res.status(502).json({ error: "FMP news fetch error" });
  }
}
