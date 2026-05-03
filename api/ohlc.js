// Vercel serverless function: /api/ohlc?ticker=AAPL&interval=1d
// Uses FMP (Financial Modeling Prep). Yahoo's chart API blocks Vercel
// datacenter egress, so this routes through FMP instead.
// Supported intervals: 1d (1-year EOD), 1m/5m/15m (~1 day), 30m (~5 days).

const FMP_BASE = "https://financialmodelingprep.com/stable";

const INTRADAY = {
  "1m": { path: "1min", bars: 390 },
  "5m": { path: "5min", bars: 78 },
  "15m": { path: "15min", bars: 26 },
  "30m": { path: "30min", bars: 65 },
};

// FMP intraday timestamps are "YYYY-MM-DD HH:MM:SS" in America/New_York
// with no TZ suffix. Convert to a real unix second value by computing the
// ET offset (EST vs EDT) for that specific instant.
function etToUnixSeconds(dateStr) {
  const asIfUtc = new Date(dateStr.replace(" ", "T") + "Z");
  if (isNaN(asIfUtc.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).formatToParts(asIfUtc);
  const tz = parts.find((p) => p.type === "timeZoneName")?.value;
  const offsetHours = tz === "EDT" ? -4 : -5;
  return Math.floor(asIfUtc.getTime() / 1000) - offsetHours * 3600;
}

function round2(v) {
  return v != null && !isNaN(v) ? Math.round(v * 100) / 100 : null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { ticker, interval } = req.query;
  if (!ticker) return res.status(400).json({ ok: false, error: "Missing ticker" });

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: "FMP_API_KEY not configured" });
  }

  const intraSpec = interval && INTRADAY[interval];
  const isIntraday = Boolean(intraSpec);
  const ival = isIntraday ? interval : "1d";

  try {
    let ohlc;
    if (isIntraday) {
      const url = `${FMP_BASE}/historical-chart/${intraSpec.path}?symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`FMP HTTP ${resp.status}`);
      const data = await resp.json();
      if (!Array.isArray(data)) throw new Error("No data from FMP");
      // FMP returns newest-first. Take the most-recent N bars then reverse
      // so the client gets oldest → newest.
      ohlc = data
        .slice(0, intraSpec.bars)
        .reverse()
        .map((c) => ({
          time: etToUnixSeconds(c.date),
          open: round2(c.open),
          high: round2(c.high),
          low: round2(c.low),
          close: round2(c.close),
          volume: Number(c.volume) || 0,
        }))
        .filter((c) => c.time != null && c.open != null && c.close != null);
    } else {
      const now = new Date();
      const fromDate = new Date(now.getTime() - 900 * 24 * 3600 * 1000);
      const fromStr = fromDate.toISOString().split("T")[0];
      const toStr = now.toISOString().split("T")[0];
      const url = `${FMP_BASE}/historical-price-eod/full?symbol=${encodeURIComponent(ticker)}&from=${fromStr}&to=${toStr}&apikey=${apiKey}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`FMP HTTP ${resp.status}`);
      const data = await resp.json();
      const rows = Array.isArray(data) ? data : data?.historical;
      if (!Array.isArray(rows)) throw new Error("No data from FMP");
      ohlc = rows
        .slice()
        .reverse()
        .map((c) => ({
          time: Math.floor(new Date(c.date + "T00:00:00Z").getTime() / 1000),
          date: c.date,
          open: round2(c.open),
          high: round2(c.high),
          low: round2(c.low),
          close: round2(c.close),
          volume: Number(c.volume) || 0,
        }))
        .filter((c) => c.open != null && c.close != null);
    }

    const cacheMaxAge = isIntraday ? 30 : 300;
    const cacheStale = isIntraday ? 60 : 600;
    res.setHeader("Cache-Control", `s-maxage=${cacheMaxAge}, stale-while-revalidate=${cacheStale}`);
    return res.json({ ok: true, ticker: ticker.toUpperCase(), ohlc, interval: ival });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
