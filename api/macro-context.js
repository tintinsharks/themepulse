// api/macro-context.js — Macro context for /scan CLI command
// Returns put/call ratio, 10Y yield, DXY, VIX, and computed regime tag
// Data sources: FMP API (free tier covers these) + CBOE put/call
//
// Env vars: FMP_API_KEY

export const config = { maxDuration: 15 };

const FMP_BASE = "https://financialmodelingprep.com/stable";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "No FMP_API_KEY" });

  try {
    // Fetch market data in parallel
    const [vixData, yieldData, dxyData, pcData] = await Promise.all([
      fetchQuote("^VIX", apiKey),
      fetchQuote("^TNX", apiKey),   // 10-year Treasury yield
      fetchQuote("DX-Y.NYB", apiKey), // US Dollar Index
      fetchPutCallRatio(apiKey),
    ]);

    // Extract values
    const vix = vixData?.price ?? null;
    const vixChg = vixData?.changesPercentage ?? null;

    const tenYearYield = yieldData?.price ?? null;
    const yieldChg = yieldData?.change ?? null;
    const yieldBps = yieldChg != null ? Math.round(yieldChg * 100) : null;

    const dxy = dxyData?.price ?? null;
    const dxyChg = dxyData?.change ?? null;

    const putCallRatio = pcData;

    // Compute regime
    const { regime, reason } = computeRegime({ vix, tenYearYield, yieldBps, dxy, dxyChg, putCallRatio });

    return res.status(200).json({
      vix, vixChg,
      tenYearYield, yieldBps,
      dxy, dxyChg,
      putCallRatio,
      regime,
      regimeReason: reason,
      generated: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function fetchQuote(symbol, apiKey) {
  try {
    const url = `${FMP_BASE}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = await r.json();
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  } catch {
    return null;
  }
}

async function fetchPutCallRatio(apiKey) {
  // Try FMP's market risk premium or economic calendar for P/C
  // Fallback: use CBOE total equity put/call from public data
  try {
    // FMP has a put/call ratio endpoint on some plans
    const url = `${FMP_BASE}/market-risk-premium?apikey=${apiKey}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      const data = await r.json();
      if (data?.putCallRatio) return data.putCallRatio;
    }
  } catch {}

  // Fallback: scrape CBOE equity P/C ratio from public page
  try {
    const r = await fetch("https://www.cboe.com/us/options/market_statistics/daily/", {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const html = await r.text();
      // Look for equity put/call ratio pattern
      const match = html.match(/equity.*?put.*?call.*?ratio.*?([\d.]+)/i)
        || html.match(/(\d+\.\d{2})\s*<\/td>\s*<\/tr>\s*<tr[^>]*>\s*<td[^>]*>Total/i);
      if (match) return parseFloat(match[1]);
    }
  } catch {}

  return null;
}

function computeRegime({ vix, tenYearYield, yieldBps, dxy, dxyChg, putCallRatio }) {
  // Score-based regime: each factor adds/subtracts points
  let score = 0;
  const factors = [];

  // VIX
  if (vix != null) {
    if (vix < 15) { score += 2; factors.push("low vol"); }
    else if (vix < 20) { score += 1; factors.push("moderate vol"); }
    else if (vix < 25) { score -= 1; factors.push("elevated vol"); }
    else if (vix < 30) { score -= 2; factors.push("high vol"); }
    else { score -= 3; factors.push("extreme vol"); }
  }

  // Yield change (rising yields = headwind for growth)
  if (yieldBps != null) {
    if (yieldBps > 10) { score -= 2; factors.push("yields spiking"); }
    else if (yieldBps > 5) { score -= 1; factors.push("yields rising"); }
    else if (yieldBps < -5) { score += 1; factors.push("yields falling"); }
  }

  // Dollar (rising dollar = headwind)
  if (dxyChg != null) {
    if (dxyChg > 0.5) { score -= 1; factors.push("dollar strong"); }
    else if (dxyChg < -0.5) { score += 1; factors.push("dollar weak"); }
  }

  // Put/Call (contrarian)
  if (putCallRatio != null) {
    if (putCallRatio > 1.1) { score += 1; factors.push("fear elevated (contrarian bullish)"); }
    else if (putCallRatio < 0.6) { score -= 1; factors.push("complacency (contrarian bearish)"); }
  }

  let regime, reason;
  if (score >= 3) {
    regime = "RISK-ON";
    reason = `Strong risk-on: ${factors.join(", ")}`;
  } else if (score >= 1) {
    regime = "MIXED";
    reason = `Leaning bullish but mixed: ${factors.join(", ")}`;
  } else if (score >= -1) {
    regime = "CAUTION";
    reason = `Caution warranted: ${factors.join(", ")}`;
  } else {
    regime = "RISK-OFF";
    reason = `Risk-off environment: ${factors.join(", ")}`;
  }

  return { regime, reason };
}
