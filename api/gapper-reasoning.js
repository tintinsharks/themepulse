// Vercel serverless function: /api/gapper-reasoning?ticker=HIMS
// Scrapes Finviz "whyMoving" daily digest + snapshot data (float, short interest)

const cache = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ ok: false, error: "Missing ticker" });

  const cacheKey = `fv_${ticker}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return res.json(cached.data);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const resp = await fetch(`https://finviz.com/quote.ashx?t=${encodeURIComponent(ticker.toUpperCase())}`, {
      headers: { "User-Agent": UA },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) throw new Error(`Finviz returned ${resp.status}`);

    const html = await resp.text();

    // Extract whyMoving JSON
    let whyMoving = null;
    const wmMatch = html.match(/"whyMoving":(.*?),"whyMovingRatings"/);
    if (wmMatch) {
      try { whyMoving = JSON.parse(wmMatch[1]); } catch {}
    }

    // Extract snapshot table values
    const snapshot = {};
    const snapPatterns = [
      ["short_float", /Short Float<\/.*?<b>([\d.]+)%/s],
      ["float", /Shs Float<\/.*?<b>([\d.]+[BMK]?)/s],
      ["short_ratio", /Short Ratio<\/.*?<b>([\d.]+)/s],
      ["inst_own", /Inst Own<\/.*?<b>([\d.]+)%/s],
      ["perf_week", /Perf Week<\/.*?<b>(-?[\d.]+)%/s],
      ["perf_month", /Perf Month<\/.*?<b>(-?[\d.]+)%/s],
    ];
    for (const [key, re] of snapPatterns) {
      const m = html.match(re);
      if (m) snapshot[key] = m[1];
    }

    // Build response
    const reasoning = whyMoving?.headline || null;
    const bullets = whyMoving?.bulletPointsList || [];
    const sentiment = whyMoving?.sentiment || null;

    const result = {
      ok: true,
      reasoning,
      bullets,
      sentiment,
      short_float: snapshot.short_float ? parseFloat(snapshot.short_float) : null,
      float_shares: snapshot.float || null,
      short_ratio: snapshot.short_ratio ? parseFloat(snapshot.short_ratio) : null,
      inst_own: snapshot.inst_own ? parseFloat(snapshot.inst_own) : null,
      perf_week: snapshot.perf_week ? parseFloat(snapshot.perf_week) : null,
      perf_month: snapshot.perf_month ? parseFloat(snapshot.perf_month) : null,
    };

    cache.set(cacheKey, { ts: Date.now(), data: result });
    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=1800");
    return res.json(result);
  } catch (e) {
    if (e.name === "AbortError") {
      return res.status(504).json({ ok: false, error: "Request timed out" });
    }
    return res.status(500).json({ ok: false, error: e.message });
  }
}
