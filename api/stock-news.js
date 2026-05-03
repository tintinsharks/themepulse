export const config = { maxDuration: 10 };

const FMP_BASE = "https://financialmodelingprep.com/stable";

const _cache = new Map();
const CACHE_MS = 30 * 60 * 1000;

const fetchJson = async (url) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return [];
    return await r.json();
  } catch { return []; }
};

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

  // fmp-articles has a tickers field (e.g. "NYSE:SNDK") — fetch a few pages
  // and filter server-side since FMP doesn't support per-ticker filtering
  const pages = await Promise.all([0, 1, 2].map((p) =>
    fetchJson(`${FMP_BASE}/fmp-articles?page=${p}&limit=100&apikey=${fmpKey}`)
  ));
  const all = pages.flat();
  const matched = all
    .filter((a) => (a.tickers || "").toUpperCase().includes(ticker))
    .slice(0, 8)
    .map((a) => ({
      title: a.title || "",
      url: a.link || "",
      source: a.site || "FMP",
      date: a.date || "",
    }));

  const data = { ticker, articles: matched };
  _cache.set(ticker, { expiry: Date.now() + CACHE_MS, data });
  return res.status(200).json(data);
}
