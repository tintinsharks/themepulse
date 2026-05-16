// api/options-bias.js — Options Bias endpoint
// Fetches Schwab options chain, computes bias score, and returns a suggested trade.
// Caches results in Upstash Redis (15 min during market hours, 60 min outside).
// Stores/refreshes OAuth tokens in Upstash Redis.
//
// Env vars required:
//   SCHWAB_CLIENT_ID        — from developer.schwab.com app
//   SCHWAB_CLIENT_SECRET    — from developer.schwab.com app
//   UPSTASH_REDIS_REST_URL  — shared with other endpoints
//   UPSTASH_REDIS_REST_TOKEN

export const config = { maxDuration: 15 };

const SCHWAB_TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";
const SCHWAB_CHAINS_URL = "https://api.schwabapi.com/marketdata/v1/chains";
const REDIS_KEY_TOKENS = "schwab:tokens";
const CACHE_PREFIX = "optbias:";
const MAX_RISK = 3000;

function isMarketHours() {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const h = et.getHours(), m = et.getMinutes();
  const mins = h * 60 + m;
  return mins >= 570 && mins <= 960; // 9:30 AM - 4:00 PM ET
}

function cacheTTL() {
  return isMarketHours() ? 900 : 3600; // 15 min during market, 60 min outside
}

// ── Upstash Redis helpers ──
const redis = (cmd, ...args) =>
  fetch(process.env.UPSTASH_REDIS_REST_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify([cmd, ...args]),
  }).then((r) => r.json());

async function getTokens() {
  const res = await redis("GET", REDIS_KEY_TOKENS);
  return res.result ? JSON.parse(res.result) : null;
}

async function saveTokens(tokens) {
  await redis("SET", REDIS_KEY_TOKENS, JSON.stringify(tokens));
}

async function getCached(symbol) {
  const res = await redis("GET", CACHE_PREFIX + symbol);
  if (!res.result) return null;
  const data = JSON.parse(res.result);
  return data;
}

async function setCache(symbol, data) {
  await redis("SET", CACHE_PREFIX + symbol, JSON.stringify(data), "EX", cacheTTL());
}

// ── OAuth token refresh ──
async function refreshAccessToken(refreshToken) {
  const clientId = process.env.SCHWAB_CLIENT_ID;
  const clientSecret = process.env.SCHWAB_CLIENT_SECRET;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const resp = await fetch(SCHWAB_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Schwab token refresh failed (${resp.status}): ${err}`);
  }
  const data = await resp.json();
  const tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    expires_at: Date.now() + (data.expires_in - 60) * 1000,
    updated: new Date().toISOString(),
  };
  await saveTokens(tokens);
  return tokens;
}

async function getValidAccessToken() {
  const tokens = await getTokens();
  if (!tokens?.refresh_token) throw new Error("NO_TOKENS");
  if (tokens.access_token && Date.now() < tokens.expires_at) return tokens.access_token;
  const refreshed = await refreshAccessToken(tokens.refresh_token);
  return refreshed.access_token;
}

// ── Schwab options chain fetch ──
async function fetchChain(symbol, accessToken) {
  const params = new URLSearchParams({
    symbol,
    contractType: "ALL",
    strikeCount: 12,
    includeUnderlyingQuote: "TRUE",
    optionType: "STANDARD",
  });
  const resp = await fetch(`${SCHWAB_CHAINS_URL}?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Schwab chain fetch failed (${resp.status}): ${err}`);
  }
  return resp.json();
}

// ── Bias scoring engine ──
function computeBias(chain) {
  const calls = [];
  const puts = [];

  for (const [, strikes] of Object.entries(chain.callExpDateMap || {})) {
    for (const [, contracts] of Object.entries(strikes)) {
      for (const c of contracts) calls.push(c);
    }
  }
  for (const [, strikes] of Object.entries(chain.putExpDateMap || {})) {
    for (const [, contracts] of Object.entries(strikes)) {
      for (const c of contracts) puts.push(c);
    }
  }

  if (calls.length === 0) return null;

  const totalCallOI = calls.reduce((s, c) => s + (c.openInterest || 0), 0);
  const totalPutOI = puts.reduce((s, c) => s + (c.openInterest || 0), 0);
  const totalCallVol = calls.reduce((s, c) => s + (c.totalVolume || 0), 0);
  const totalPutVol = puts.reduce((s, c) => s + (c.totalVolume || 0), 0);

  const pcOI = totalCallOI > 0 ? totalPutOI / totalCallOI : 1;
  const pcVol = totalCallVol > 0 ? totalPutVol / totalCallVol : 1;

  const allIVs = [...calls, ...puts].map((c) => c.volatility).filter((v) => v > 0);
  const ivMin = Math.min(...allIVs);
  const ivMax = Math.max(...allIVs);
  const underlyingPrice = chain.underlyingPrice || chain.underlying?.last || 0;

  const atmCall = calls.reduce((best, c) =>
    Math.abs(c.strikePrice - underlyingPrice) < Math.abs((best?.strikePrice || 999999) - underlyingPrice) ? c : best,
    null
  );
  const atmIV = atmCall?.volatility || 0;
  const ivRank = ivMax > ivMin ? ((atmIV - ivMin) / (ivMax - ivMin)) * 100 : 50;

  const atmPut = puts.reduce((best, c) =>
    Math.abs(c.strikePrice - underlyingPrice) < Math.abs((best?.strikePrice || 999999) - underlyingPrice) ? c : best,
    null
  );
  const skew = (atmPut?.volatility || 0) - (atmCall?.volatility || 0);

  let score = 5;
  if (pcOI < 0.7) score += 1.5;
  else if (pcOI < 0.9) score += 0.5;
  else if (pcOI > 1.3) score -= 1.5;
  else if (pcOI > 1.1) score -= 0.5;

  if (pcVol < 0.6) score += 1;
  else if (pcVol > 1.2) score -= 1;

  if (ivRank < 30) score += 0.5;
  else if (ivRank > 70) score -= 0.5;

  if (skew > 3) score += 0.5;
  else if (skew < -3) score -= 0.5;

  score = Math.max(0, Math.min(10, score));

  const direction = score >= 6.5 ? "BULLISH" : score <= 3.5 ? "BEARISH" : "NEUTRAL";

  return {
    score: Math.round(score * 10) / 10,
    direction,
    pcOI: Math.round(pcOI * 100) / 100,
    pcVol: Math.round(pcVol * 100) / 100,
    ivRank: Math.round(ivRank),
    atmIV: Math.round(atmIV * 100) / 100,
    skew: Math.round(skew * 100) / 100,
    underlyingPrice,
    totalCallOI,
    totalPutOI,
    totalCallVol,
    totalPutVol,
  };
}

// ── Liquidity check: should we trade options or shares? ──
function checkLiquidity(chain, underlyingPrice) {
  const calls = [];
  for (const [, strikes] of Object.entries(chain.callExpDateMap || {})) {
    for (const [, contracts] of Object.entries(strikes)) {
      for (const c of contracts) calls.push(c);
    }
  }
  const candidates = calls.filter(
    (c) => c.daysToExpiration >= 45 && c.daysToExpiration <= 120 && Math.abs(c.strikePrice - underlyingPrice) / underlyingPrice < 0.05
  );
  if (candidates.length === 0)
    return { useOptions: false, reason: "No suitable strikes with 45-120 DTE near ATM" };

  const best = candidates.reduce((a, b) => {
    const aScore = Math.abs(a.delta + 0.62) + (a.ask - a.bid) / (a.mark || 1);
    const bScore = Math.abs(b.delta + 0.62) + (b.ask - b.bid) / (b.mark || 1);
    return aScore < bScore ? a : b;
  }, candidates[0]);

  const spread = best.ask - best.bid;
  const spreadPct = best.mark > 0 ? (spread / best.mark) * 100 : 100;
  const oi = best.openInterest || 0;
  const vol = best.totalVolume || 0;

  const failures = [];
  if (spreadPct > 8) failures.push(`wide spreads (${spreadPct.toFixed(0)}%)`);
  if (oi < 500) failures.push(`low OI (${oi})`);
  if (vol < 100) failures.push(`low volume (${vol})`);
  if (underlyingPrice < 20) failures.push("stock under $20");

  if (failures.length > 0) return { useOptions: false, reason: failures.join(", ") };
  return { useOptions: true, bestContract: best };
}

// ── Build both trades (always returns optionsTrade + sharesTrade) ──
function buildTrades(chain, bias, liquidity, maxRisk) {
  const price = bias.underlyingPrice;

  // Always build shares trade — size so max loss at stop = maxRisk
  const stopPct = 0.07;
  const stopPrice = Math.round(price * (1 - stopPct) * 100) / 100;
  const riskPerShare = price - stopPrice;
  const shareCount = riskPerShare > 0 ? Math.floor(maxRisk / riskPerShare) : 0;
  const sharesTrade = {
    shares: shareCount,
    cost: Math.round(shareCount * price),
    stopPrice,
    risk: Math.round(shareCount * riskPerShare),
  };

  // Try to build options trade
  const calls = [];
  for (const [, strikes] of Object.entries(chain.callExpDateMap || {})) {
    for (const [, contracts] of Object.entries(strikes)) {
      for (const c of contracts) if (c.putCall === "CALL") calls.push(c);
    }
  }

  const viable = calls.filter(
    (c) =>
      c.daysToExpiration >= 45 &&
      c.daysToExpiration <= 120 &&
      Math.abs(c.delta) >= 0.40 &&
      Math.abs(c.delta) <= 0.80 &&
      c.ask > 0 &&
      c.openInterest >= 50
  );

  let optionsTrade = null;
  let optionsWarnings = [];

  if (viable.length === 0) {
    optionsWarnings.push("No viable contracts found");
  } else {
    viable.sort((a, b) => {
      const aD = Math.abs(Math.abs(a.delta) - 0.62);
      const bD = Math.abs(Math.abs(b.delta) - 0.62);
      const aDTE = Math.abs(a.daysToExpiration - 67);
      const bDTE = Math.abs(b.daysToExpiration - 67);
      const aSpread = (a.ask - a.bid) / (a.mark || 1);
      const bSpread = (b.ask - b.bid) / (b.mark || 1);
      return aD + aDTE / 100 + aSpread - (bD + bDTE / 100 + bSpread);
    });

    const pick = viable[0];
    const askPrice = pick.ask;
    const spread = pick.ask - pick.bid;
    const spreadPct = pick.mark > 0 ? (spread / pick.mark) * 100 : 100;
    const oi = pick.openInterest || 0;
    const vol = pick.totalVolume || 0;

    if (spreadPct > 8) optionsWarnings.push(`wide spread (${spreadPct.toFixed(0)}%)`);
    if (oi < 500) optionsWarnings.push(`low OI (${oi})`);
    if (vol < 100) optionsWarnings.push(`low vol (${vol})`);
    if (price < 20) optionsWarnings.push("stock under $20");

    const contracts = Math.floor(maxRisk / (askPrice * 100));
    if (contracts === 0) {
      optionsWarnings.push(`1 contract costs $${Math.round(askPrice * 100).toLocaleString()} (exceeds $${maxRisk.toLocaleString()} risk)`);
      return { optionsTrade: null, sharesTrade };
    }
    const totalCost = Math.round(contracts * askPrice * 100);
    const halfContracts = Math.max(1, Math.floor(contracts / 2));
    const exerciseContracts = contracts - halfContracts;
    const exerciseShares = exerciseContracts * 100;

    const expDate = new Date();
    expDate.setDate(expDate.getDate() + pick.daysToExpiration - 21);
    const hardExit = expDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });

    const breakeven = Math.round((pick.strikePrice + askPrice) * 100) / 100;
    const profitAt50 = Math.round(contracts * askPrice * 100 * 0.5);
    const targetPrice = Math.round((price + (askPrice * 0.5) / Math.abs(pick.delta)) * 100) / 100;
    const maxLoss = totalCost;

    optionsTrade = {
      symbol: pick.symbol || `${chain.symbol} $${pick.strikePrice}C`,
      strike: pick.strikePrice,
      expiration: (() => {
        const d = new Date();
        d.setDate(d.getDate() + pick.daysToExpiration);
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      })(),
      dte: pick.daysToExpiration,
      ask: askPrice,
      delta: Math.round(Math.abs(pick.delta) * 100) / 100,
      iv: Math.round(pick.volatility * 100) / 100,
      contracts,
      totalCost,
      sellHalf: halfContracts,
      exerciseShares,
      effectiveBasis: breakeven,
      breakeven,
      targetPrice,
      profitAt50,
      maxLoss,
      hardExit,
      warnings: optionsWarnings.length > 0 ? optionsWarnings : null,
    };
  }

  return { optionsTrade, sharesTrade };
}

// ── Main handler ──
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", `s-maxage=${cacheTTL()}, stale-while-revalidate=${cacheTTL() * 2}`);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { symbol, action } = req.query;

  // POST /api/options-bias?action=set-tokens — initial token seeding
  if (req.method === "POST" && action === "set-tokens") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (!body.access_token || !body.refresh_token) {
        return res.status(400).json({ error: "need access_token and refresh_token" });
      }
      await saveTokens({
        access_token: body.access_token,
        refresh_token: body.refresh_token,
        expires_at: Date.now() + (body.expires_in || 1800 - 60) * 1000,
        updated: new Date().toISOString(),
      });
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // GET /api/options-bias?symbol=UBER
  if (!symbol) return res.status(400).json({ error: "symbol required" });
  const sym = symbol.toUpperCase();

  // Check Redis cache first
  try {
    const cached = await getCached(sym);
    if (cached) {
      return res.status(200).json({ ...cached, cached: true });
    }
  } catch (_) {
    // cache miss — continue to live fetch
  }

  try {
    const accessToken = await getValidAccessToken();
    const chain = await fetchChain(sym, accessToken);

    const underlyingPrice = chain.underlyingPrice || chain.underlying?.last || 0;
    if (!underlyingPrice) return res.status(404).json({ error: "No chain data for symbol" });

    const bias = computeBias(chain);
    if (!bias) return res.status(404).json({ error: "Insufficient options data" });

    const liquidity = checkLiquidity(chain, underlyingPrice);
    const { optionsTrade, sharesTrade } = buildTrades(chain, bias, liquidity, MAX_RISK);

    const result = {
      symbol: sym,
      bias,
      optionsTrade,
      sharesTrade,
      cached: false,
      ts: new Date().toISOString(),
    };

    // Cache in Redis (fire-and-forget — don't block response)
    setCache(sym, result).catch(() => {});

    return res.status(200).json(result);
  } catch (e) {
    if (e.message === "NO_TOKENS") {
      return res.status(401).json({
        error: "Schwab tokens not configured. POST to /api/options-bias?action=set-tokens with {access_token, refresh_token}",
      });
    }
    return res.status(500).json({ error: e.message });
  }
}
