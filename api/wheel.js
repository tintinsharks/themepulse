// api/wheel.js — Wheel strategy screener
//
// Screens the options chain for the two legs of the wheel:
//   Leg 1 (cash) — cash-secured puts: sell a put, collect premium, get assigned or expire
//   Leg 2 (long) — covered calls: sell a call against assigned shares
//
// This is a SCREENER, not a recommender. It ranks contracts by yield and
// surfaces the risk flags (earnings in cycle, thin liquidity, wide spread,
// strike below cost basis). Trade selection stays with the user.
//
// GET /api/wheel?symbol=NVDA&capital=100000&minDte=7&maxDte=60
//   &basis=171.30&shares=200&minDelta=0.10&maxDelta=0.40&minOi=50
//
// Response:
//   { symbol, underlyingPrice, ivRank, atmIV, skew, earnings,
//     puts: [...], calls: [...], meta: {...} }
//
// Env vars required (shared with api/options-bias.js):
//   SCHWAB_CLIENT_ID, SCHWAB_CLIENT_SECRET
//   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
//   FMP_API_KEY  (earnings date — optional, degrades to null)

export const config = { maxDuration: 20 };

const SCHWAB_TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";
const SCHWAB_CHAINS_URL = "https://api.schwabapi.com/marketdata/v1/chains";
const REDIS_KEY_TOKENS = "schwab:tokens";
const CACHE_PREFIX = "wheel:";

const DEFAULTS = {
  minDte: 7,
  maxDte: 60,
  minDelta: 0.10,
  maxDelta: 0.40,
  minOi: 50,
  capital: 100000,
};

// Delta band considered the conventional wheel "sweet spot" — used only to
// tag rows in the UI, never to filter them out.
export const SWEET_SPOT = { lo: 0.15, hi: 0.30 };

function isMarketHours() {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= 570 && mins <= 960; // 9:30 AM – 4:00 PM ET
}

const cacheTTL = () => (isMarketHours() ? 300 : 3600); // 5 min live, 60 min after

// ── Upstash Redis helpers ──
const redis = (cmd, ...args) =>
  fetch(process.env.UPSTASH_REDIS_REST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([cmd, ...args]),
  }).then((r) => r.json());

async function getTokens() {
  const res = await redis("GET", REDIS_KEY_TOKENS);
  return res.result ? JSON.parse(res.result) : null;
}

async function saveTokens(tokens) {
  await redis("SET", REDIS_KEY_TOKENS, JSON.stringify(tokens));
}

async function refreshAccessToken(refreshToken) {
  const basic = Buffer.from(
    `${process.env.SCHWAB_CLIENT_ID}:${process.env.SCHWAB_CLIENT_SECRET}`
  ).toString("base64");
  const resp = await fetch(SCHWAB_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
  });
  if (!resp.ok) throw new Error(`Schwab token refresh failed (${resp.status}): ${await resp.text()}`);
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
  return (await refreshAccessToken(tokens.refresh_token)).access_token;
}

// ── Schwab chain fetch ──
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

async function fetchChain(symbol, accessToken, minDte, maxDte) {
  const from = new Date();
  from.setDate(from.getDate() + minDte);
  const to = new Date();
  to.setDate(to.getDate() + maxDte);

  const params = new URLSearchParams({
    symbol,
    contractType: "ALL",
    strikeCount: 40,
    includeUnderlyingQuote: "TRUE",
    optionType: "STANDARD",
    fromDate: isoDate(from),
    toDate: isoDate(to),
  });
  const resp = await fetch(`${SCHWAB_CHAINS_URL}?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) throw new Error(`Schwab chain fetch failed (${resp.status}): ${await resp.text()}`);
  return resp.json();
}

// ── Chain flattening ────────────────────────────────────────────────────────
// Schwab nests as expDateMap: { "2026-08-15:11": { "175.0": [contract] } }.
// The map key carries the true expiration date — more reliable than deriving
// it from daysToExpiration, which is a rounded integer.
export function flattenExpMap(expMap) {
  const out = [];
  for (const [expKey, strikes] of Object.entries(expMap || {})) {
    const expDate = String(expKey).split(":")[0];
    for (const [, contracts] of Object.entries(strikes || {})) {
      for (const c of contracts || []) out.push({ ...c, expDate });
    }
  }
  return out;
}

// ── IV rank / skew across the fetched chain ─────────────────────────────────
export function computeIvContext(calls, puts, underlyingPrice) {
  const ivs = [...calls, ...puts].map((c) => c.volatility).filter((v) => v > 0);
  if (ivs.length === 0) return { ivRank: null, atmIV: null, skew: null };

  const nearest = (arr) =>
    arr.reduce(
      (best, c) =>
        Math.abs(c.strikePrice - underlyingPrice) <
        Math.abs((best?.strikePrice ?? Infinity) - underlyingPrice)
          ? c
          : best,
      null
    );

  const atmCall = nearest(calls);
  const atmPut = nearest(puts);
  const atmIV = atmCall?.volatility || 0;
  const ivMin = Math.min(...ivs);
  const ivMax = Math.max(...ivs);

  return {
    // NOTE: this is IV rank *across the current chain's strikes/expiries*, not
    // a 52-week IV rank. It answers "is this strike rich vs. its neighbours",
    // not "is NVDA vol high vs. its own history". Schwab's chain endpoint does
    // not carry historical IV; a true IV rank needs a separate vol history feed.
    ivRank: ivMax > ivMin ? Math.round(((atmIV - ivMin) / (ivMax - ivMin)) * 100) : 50,
    atmIV: Math.round(atmIV * 100) / 100,
    skew: Math.round(((atmPut?.volatility || 0) - atmIV) * 100) / 100,
  };
}

const r2 = (v) => Math.round(v * 100) / 100;

// Split a premium into intrinsic and extrinsic (time) value.
//
// This matters more than it looks. An ITM contract's premium is mostly
// intrinsic — capital you are pre-paid for giving up, not income earned for
// taking risk. Ranking on total premium therefore sorts deep-ITM contracts to
// the top of every screen and makes them look like the highest-yielding wheel
// trades, which they are not. Extrinsic value is the actual income the wheel
// harvests, so yield is computed on that.
//
// Total premium is still the right input for breakeven and called-away P/L —
// those are cash-flow facts, not yield.
export function splitPremium(putCall, strike, premium, underlyingPrice) {
  const intrinsic =
    putCall === "PUT"
      ? Math.max(0, strike - underlyingPrice)
      : Math.max(0, underlyingPrice - strike);
  return { intrinsic: r2(intrinsic), extrinsic: r2(Math.max(0, premium - intrinsic)) };
}

function liquidityWarnings(c, premium) {
  const w = [];
  const mid = c.mark > 0 ? c.mark : (c.bid + c.ask) / 2;
  const spreadPct = mid > 0 ? ((c.ask - c.bid) / mid) * 100 : 100;
  if (spreadPct > 10) w.push(`wide spread ${spreadPct.toFixed(0)}%`);
  if ((c.openInterest || 0) < 250) w.push(`low OI ${c.openInterest || 0}`);
  if ((c.totalVolume || 0) < 25) w.push(`thin volume ${c.totalVolume || 0}`);
  if (premium < 0.05) w.push("premium under $0.05");
  return { warnings: w, spreadPct: r2(spreadPct) };
}

// ── Cash-secured put leg ────────────────────────────────────────────────────
export function buildPutCandidates(puts, ctx) {
  const { underlyingPrice, capital, minDte, maxDte, minDelta, maxDelta, minOi, earningsDate } = ctx;
  const rows = [];

  for (const c of puts) {
    const dte = c.daysToExpiration;
    if (dte < minDte || dte > maxDte) continue;

    const delta = Math.abs(c.delta ?? 0);
    // Schwab returns delta as "NaN" (string) for illiquid contracts.
    if (!Number.isFinite(delta) || delta <= 0) continue;
    if (delta < minDelta || delta > maxDelta) continue;
    if ((c.openInterest || 0) < minOi) continue;

    // Sell at the bid — the conservative assumption for a fill.
    const premium = c.bid;
    if (!(premium > 0)) continue;

    const strike = c.strikePrice;
    const collateral = strike * 100;
    const { intrinsic, extrinsic } = splitPremium("PUT", strike, premium, underlyingPrice);
    // Yield runs on extrinsic value — the income actually earned for carrying
    // the assignment risk. Total premium is kept separately for breakeven.
    const staticReturn = (extrinsic * 100) / collateral;
    const annualized = dte > 0 ? staticReturn * (365 / dte) : 0;
    const breakeven = strike - premium;
    const cushionPct = ((underlyingPrice - breakeven) / underlyingPrice) * 100;
    const maxContracts = Math.floor(capital / collateral);

    const { warnings, spreadPct } = liquidityWarnings(c, premium);
    const earningsInCycle = earningsDate ? earningsDate <= c.expDate : false;

    rows.push({
      expiration: c.expDate,
      dte,
      strike,
      bid: r2(c.bid),
      ask: r2(c.ask),
      mark: r2(c.mark || (c.bid + c.ask) / 2),
      delta: r2(delta),
      iv: r2(c.volatility || 0),
      oi: c.openInterest || 0,
      volume: c.totalVolume || 0,
      spreadPct,
      premium: r2(premium),
      intrinsic,
      extrinsic,
      itm: strike > underlyingPrice,
      premiumPerContract: Math.round(premium * 100),
      collateral: Math.round(collateral),
      maxContracts,
      capitalDeployed: Math.round(maxContracts * collateral),
      staticReturnPct: r2(staticReturn * 100),
      annualizedPct: r2(annualized * 100),
      breakeven: r2(breakeven),
      cushionPct: r2(cushionPct),
      otmPct: r2(((underlyingPrice - strike) / underlyingPrice) * 100),
      sweetSpot: delta >= SWEET_SPOT.lo && delta <= SWEET_SPOT.hi,
      earningsInCycle,
      warnings: warnings.length ? warnings : null,
    });
  }

  rows.sort((a, b) => b.annualizedPct - a.annualizedPct);
  return rows;
}

// ── Covered call leg (post-assignment) ──────────────────────────────────────
export function buildCallCandidates(calls, ctx) {
  const { underlyingPrice, basis, shares, minDte, maxDte, minDelta, maxDelta, minOi, earningsDate } = ctx;
  if (!basis || !shares) return [];

  const lots = Math.floor(shares / 100);
  if (lots < 1) return [];

  const rows = [];
  for (const c of calls) {
    const dte = c.daysToExpiration;
    if (dte < minDte || dte > maxDte) continue;

    const delta = Math.abs(c.delta ?? 0);
    if (!Number.isFinite(delta) || delta <= 0) continue;
    if (delta < minDelta || delta > maxDelta) continue;
    if ((c.openInterest || 0) < minOi) continue;

    const premium = c.bid;
    if (!(premium > 0)) continue;

    const strike = c.strikePrice;
    const { intrinsic, extrinsic } = splitPremium("CALL", strike, premium, underlyingPrice);
    // Return is measured against cost basis — the capital actually tied up in
    // the shares, not current market value — and on extrinsic value only, so
    // deep-ITM calls don't masquerade as high-yield income trades.
    const staticReturn = extrinsic / basis;
    const annualized = dte > 0 ? staticReturn * (365 / dte) : 0;
    // If called away: capital gain to the strike plus the premium collected.
    const calledAwayPL = Math.round((strike - basis + premium) * 100 * lots);
    const belowBasis = strike < basis;

    const { warnings, spreadPct } = liquidityWarnings(c, premium);
    if (belowBasis) warnings.push("strike below cost basis — locks a loss if called");
    const earningsInCycle = earningsDate ? earningsDate <= c.expDate : false;

    rows.push({
      expiration: c.expDate,
      dte,
      strike,
      bid: r2(c.bid),
      ask: r2(c.ask),
      mark: r2(c.mark || (c.bid + c.ask) / 2),
      delta: r2(delta),
      iv: r2(c.volatility || 0),
      oi: c.openInterest || 0,
      volume: c.totalVolume || 0,
      spreadPct,
      premium: r2(premium),
      intrinsic,
      extrinsic,
      itm: strike < underlyingPrice,
      premiumTotal: Math.round(premium * 100 * lots),
      contracts: lots,
      staticReturnPct: r2(staticReturn * 100),
      annualizedPct: r2(annualized * 100),
      calledAwayPL,
      belowBasis,
      otmPct: r2(((strike - underlyingPrice) / underlyingPrice) * 100),
      sweetSpot: delta >= SWEET_SPOT.lo && delta <= SWEET_SPOT.hi,
      earningsInCycle,
      warnings: warnings.length ? warnings : null,
    });
  }

  rows.sort((a, b) => b.annualizedPct - a.annualizedPct);
  return rows;
}

// ── Full screen — pure, so it can be tested without network ─────────────────
export function buildWheel(chain, opts) {
  const calls = flattenExpMap(chain.callExpDateMap);
  const puts = flattenExpMap(chain.putExpDateMap);
  const underlyingPrice =
    chain.underlyingPrice || chain.underlying?.last || chain.underlying?.mark || 0;

  if (!underlyingPrice) throw new Error("No underlying price in chain response");

  const ctx = { ...DEFAULTS, ...opts, underlyingPrice };
  const ivCtx = computeIvContext(calls, puts, underlyingPrice);

  return {
    symbol: chain.symbol || opts.symbol,
    underlyingPrice: r2(underlyingPrice),
    ...ivCtx,
    puts: buildPutCandidates(puts, ctx),
    calls: buildCallCandidates(calls, ctx),
    params: {
      minDte: ctx.minDte,
      maxDte: ctx.maxDte,
      minDelta: ctx.minDelta,
      maxDelta: ctx.maxDelta,
      minOi: ctx.minOi,
      capital: ctx.capital,
      basis: ctx.basis || null,
      shares: ctx.shares || 0,
    },
  };
}

// ── Earnings lookup (best-effort) ───────────────────────────────────────────
async function fetchEarnings(symbol, origin) {
  try {
    const r = await fetch(`${origin}/api/earnings?ticker=${encodeURIComponent(symbol)}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.next?.date ? j.next : null;
  } catch {
    return null;
  }
}

// ── Handler ─────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const q = req.query || {};
  const symbol = String(q.symbol || "NVDA").toUpperCase();

  const num = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const opts = {
    symbol,
    capital: num(q.capital, DEFAULTS.capital),
    minDte: num(q.minDte, DEFAULTS.minDte),
    maxDte: num(q.maxDte, DEFAULTS.maxDte),
    minDelta: num(q.minDelta, DEFAULTS.minDelta),
    maxDelta: num(q.maxDelta, DEFAULTS.maxDelta),
    minOi: num(q.minOi, DEFAULTS.minOi),
    basis: num(q.basis, 0),
    shares: num(q.shares, 0),
  };

  // Cache key covers every input that changes the output.
  const cacheKey =
    CACHE_PREFIX +
    [symbol, opts.capital, opts.minDte, opts.maxDte, opts.minDelta, opts.maxDelta, opts.minOi, opts.basis, opts.shares].join(":");

  try {
    const cached = await redis("GET", cacheKey).catch(() => ({}));
    if (cached?.result) {
      const data = JSON.parse(cached.result);
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ ...data, meta: { ...data.meta, cached: true } });
    }
  } catch {
    // Cache miss or Redis down — fall through to a live fetch.
  }

  try {
    const accessToken = await getValidAccessToken();
    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const origin = `${proto}://${host}`;

    const [chain, earnings] = await Promise.all([
      fetchChain(symbol, accessToken, opts.minDte, opts.maxDte),
      fetchEarnings(symbol, origin),
    ]);

    const result = buildWheel(chain, { ...opts, earningsDate: earnings?.date || null });
    result.earnings = earnings;
    result.meta = { cached: false, generated: new Date().toISOString(), marketHours: isMarketHours() };

    await redis("SET", cacheKey, JSON.stringify(result), "EX", cacheTTL()).catch(() => {});

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(result);
  } catch (err) {
    const msg = String(err.message || err);
    if (msg.includes("NO_TOKENS")) {
      return res.status(401).json({
        error: "Schwab not linked",
        detail: "Authorize at /api/schwab-callback to enable the options chain.",
      });
    }
    return res.status(502).json({ error: "Wheel screen failed", detail: msg });
  }
}
