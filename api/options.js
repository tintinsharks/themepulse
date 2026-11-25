// api/options.js — Live Options Chain & Multi-Ticker Flow/Call Scanner
//
// Primary data source: Cboe CDN options JSON (exchange-computed Greeks, all
// expirations in one fast request, no crumb rate limits).
// Automatic fallback: Yahoo Finance v7 options API (query1/query2 crumb).
//
// Routes:
//   GET /api/options?ticker=QQQ[&date=UNIX][&swing=1]
//       → Single-ticker full option chain (plus optional 25–65 DTE swing expiry)
//   GET /api/options?mode=scan&tickers=NVDA,PLTR,...
//       → Batched multi-ticker scan (near-term flow + 25–65 DTE swing call chain)

import { requireAuth } from "./auth.js";

export const config = { maxDuration: 25 };

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

// ── Warm caches (module-level across warm Vercel invocations) ────────────────
const _cboeFullCache = new Map(); // ticker -> { data, exp }
const _yahooCache = new Map();
const CHAIN_TTL_MS = 45 * 1000;
const SCAN_TTL_MS = 60 * 1000;

function cacheGet(map, key) {
  const hit = map.get(key);
  if (hit && hit.exp > Date.now()) return hit.data;
  if (hit) map.delete(key);
  return null;
}

function cacheSet(map, key, data, ttlMs = CHAIN_TTL_MS) {
  if (map.size > 250) {
    const first = map.keys().next().value;
    if (first) map.delete(first);
  }
  map.set(key, { data, exp: Date.now() + ttlMs });
}

function unixToIso(unix) {
  if (!unix || !Number.isFinite(unix)) return null;
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

function isoToUnix(iso) {
  if (!iso) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function calcDte(unix, nowMs = Date.now()) {
  if (!unix || !Number.isFinite(unix)) return 0;
  const expCloseMs = unix * 1000 + 20 * 3600 * 1000;
  return Math.max(0, Math.round((expCloseMs - nowMs) / (24 * 3600 * 1000)));
}

// Parse standard OCC symbol: NVDA261211P00130000 -> { expIso, expUnix, type, strike }
function parseOcc(sym) {
  const m = String(sym || "").match(/^([A-Z0-9.]+?)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!m) return null;
  const expIso = `20${m[2]}-${m[3]}-${m[4]}`;
  return {
    expIso,
    expUnix: isoToUnix(expIso),
    type: m[5] === "C" ? "call" : "put",
    strike: Number(m[6]) / 1000,
  };
}

function isMonthlyOpex(iso) {
  if (!iso || iso.length < 10) return false;
  const dt = new Date(`${iso}T12:00:00Z`);
  return dt.getUTCDay() === 5 && dt.getUTCDate() >= 15 && dt.getUTCDate() <= 21;
}

// Pick best swing expiration in the 24–70 DTE sweet spot, strongly preferring
// monthly OPEX (3rd Friday, far higher liquidity/strikes than far weeklies).
function pickSwingExpiration(expirations, excludeUnix = null) {
  if (!Array.isArray(expirations) || !expirations.length) return null;
  const inBand = expirations.filter((e) => e.dte >= 24 && e.dte <= 70);
  const monthlyInBand = inBand.filter((e) => isMonthlyOpex(e.date));
  const pool = monthlyInBand.length
    ? monthlyInBand
    : inBand.length
      ? inBand
      : expirations.filter((e) => e.dte >= 14 && e.dte <= 100);
  if (!pool.length) return null;
  const best = [...pool].sort((a, b) => Math.abs(a.dte - 45) - Math.abs(b.dte - 45))[0];
  if (!best || best.unix === excludeUnix) return null;
  return best;
}

function compactChainForScan(chain, spot) {
  if (!chain || !spot) return chain;
  const keep = (arr) =>
    arr.filter((c) => {
      const moneyness = Math.abs(c.strike - spot) / spot;
      return moneyness <= 0.25 || c.vol >= 100 || c.oi >= 500;
    });
  return {
    ...chain,
    calls: keep(chain.calls),
    puts: keep(chain.puts),
  };
}

// ── Primary Source: Cboe Delayed/Live Options CDN ────────────────────────────
async function fetchCboeFull(ticker, ttlMs = CHAIN_TTL_MS) {
  const cached = cacheGet(_cboeFullCache, ticker);
  if (cached) return cached;

  // Cboe uses _SPX / _VIX for indexes, plain ticker for stocks/ETFs
  const clean = ticker.replace(/^\^/, "_");
  const url = `https://cdn.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(clean)}.json`;
  const resp = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
      Referer: "https://www.cboe.com/",
    },
    signal: AbortSignal.timeout(9000),
  });
  if (!resp.ok) return null;
  const json = await resp.json();
  const d = json?.data;
  if (!d || !Array.isArray(d.options) || !d.options.length) return null;

  const spot =
    (Number.isFinite(d.current_price) && d.current_price > 0 ? d.current_price : null) ??
    (Number.isFinite(d.close) && d.close > 0 ? d.close : null);
  if (!spot) return null;

  const prevClose = Number.isFinite(d.prev_day_close) && d.prev_day_close > 0 ? d.prev_day_close : null;
  const changePct =
    Number.isFinite(d.percent_change)
      ? d.percent_change
      : prevClose
        ? Math.round(((spot / prevClose) - 1) * 10000) / 100
        : null;

  const nowMs = Date.now();
  const byExp = new Map(); // expUnix -> { unix, date, dte, calls, puts }

  for (const o of d.options) {
    const parsed = parseOcc(o.option);
    if (!parsed || !parsed.expUnix) continue;
    let bucket = byExp.get(parsed.expUnix);
    if (!bucket) {
      bucket = {
        unix: parsed.expUnix,
        date: parsed.expIso,
        dte: calcDte(parsed.expUnix, nowMs),
        calls: [],
        puts: [],
      };
      byExp.set(parsed.expUnix, bucket);
    }
    const isCall = parsed.type === "call";
    const row = {
      sym: o.option || "",
      strike: parsed.strike,
      bid: Number.isFinite(o.bid) ? o.bid : 0,
      ask: Number.isFinite(o.ask) ? o.ask : 0,
      last: Number.isFinite(o.last_trade_price) ? o.last_trade_price : 0,
      chg: Number.isFinite(o.change) ? o.change : null,
      chgPct: Number.isFinite(o.percent_change) ? o.percent_change : null,
      vol: Number.isFinite(o.volume) ? o.volume : 0,
      oi: Number.isFinite(o.open_interest) ? o.open_interest : 0,
      iv: Number.isFinite(o.iv) && o.iv > 0 ? o.iv : null,
      delta: Number.isFinite(o.delta) ? Math.round(o.delta * 1000) / 1000 : null,
      gamma: Number.isFinite(o.gamma) ? Math.round(o.gamma * 100000) / 100000 : null,
      theta: Number.isFinite(o.theta) ? Math.round(o.theta * 1000) / 1000 : null,
      vega: Number.isFinite(o.vega) ? Math.round(o.vega * 1000) / 1000 : null,
      itm: isCall ? parsed.strike < spot : parsed.strike > spot,
      exp: parsed.expUnix,
    };
    if (isCall) bucket.calls.push(row);
    else bucket.puts.push(row);
  }

  const expirations = [...byExp.values()]
    .sort((a, b) => a.unix - b.unix)
    .map((b) => {
      b.calls.sort((x, y) => x.strike - y.strike);
      b.puts.sort((x, y) => x.strike - y.strike);
      return { unix: b.unix, date: b.date, dte: b.dte };
    });

  if (!expirations.length) return null;

  const full = {
    source: "cboe",
    ticker: ticker.toUpperCase(),
    name: d.name || "",
    spot,
    changePct,
    prevClose,
    iv30: Number.isFinite(d.iv30) ? d.iv30 : null,
    expirations,
    byExp,
    asOf: new Date().toISOString(),
  };
  cacheSet(_cboeFullCache, ticker, full, ttlMs);
  return full;
}

function sliceCboeBundle(full, { dateUnix = null, wantSwing = true, compact = false } = {}) {
  const targetExp = (dateUnix && full.byExp.has(dateUnix) ? full.byExp.get(dateUnix) : null)
    || full.byExp.get(full.expirations[0].unix);
  if (!targetExp) return null;

  let swingExp = null;
  if (wantSwing && !(targetExp.dte >= 24 && targetExp.dte <= 70)) {
    const sw = pickSwingExpiration(full.expirations, targetExp.unix);
    if (sw) swingExp = full.byExp.get(sw.unix) || null;
  }

  return {
    source: "cboe",
    ticker: full.ticker,
    name: full.name,
    spot: full.spot,
    changePct: full.changePct,
    prevClose: full.prevClose,
    iv30: full.iv30,
    expirations: full.expirations,
    selected: compact ? compactChainForScan(targetExp, full.spot) : targetExp,
    swingChain: swingExp ? (compact ? compactChainForScan(swingExp, full.spot) : swingExp) : null,
    asOf: full.asOf,
  };
}

// ── Secondary Fallback: Yahoo Finance v7 Options (query1/query2 crumb) ───────
let _crumb = null;
let _cookies = null;
let _crumbHost = "query1.finance.yahoo.com";
let _crumbExp = 0;

async function getYahooCrumb(force = false) {
  if (!force && _crumb && _cookies && Date.now() < _crumbExp) {
    return { crumb: _crumb, cookies: _cookies, host: _crumbHost };
  }
  const initResp = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": UA },
    redirect: "manual",
    signal: AbortSignal.timeout(7000),
  });
  const setCookies = initResp.headers.getSetCookie?.() || [];
  const cookieStr = setCookies.map((c) => c.split(";")[0]).join("; ");

  let lastStatus = 0;
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    const crumbResp = await fetch(`https://${host}/v1/test/getcrumb`, {
      headers: { "User-Agent": UA, Cookie: cookieStr },
      signal: AbortSignal.timeout(7000),
    });
    lastStatus = crumbResp.status;
    if (crumbResp.ok) {
      const crumb = await crumbResp.text();
      _crumb = crumb;
      _cookies = cookieStr;
      _crumbHost = host;
      _crumbExp = Date.now() + 10 * 60 * 1000;
      return { crumb, cookies: cookieStr, host };
    }
  }
  throw new Error(`Yahoo crumb failed: ${lastStatus}`);
}

function slimYahooContract(c) {
  return {
    sym: c.contractSymbol || "",
    strike: Number.isFinite(c.strike) ? c.strike : null,
    bid: Number.isFinite(c.bid) ? c.bid : 0,
    ask: Number.isFinite(c.ask) ? c.ask : 0,
    last: Number.isFinite(c.lastPrice) ? c.lastPrice : 0,
    chg: Number.isFinite(c.change) ? c.change : null,
    chgPct: Number.isFinite(c.percentChange) ? c.percentChange : null,
    vol: Number.isFinite(c.volume) ? c.volume : 0,
    oi: Number.isFinite(c.openInterest) ? c.openInterest : 0,
    iv: Number.isFinite(c.impliedVolatility) ? c.impliedVolatility : null,
    itm: Boolean(c.inTheMoney),
    exp: c.expiration || null,
  };
}

async function fetchYahooOptionsRaw(ticker, dateUnix = null, retry = true) {
  const { crumb, cookies, host } = await getYahooCrumb(false);
  const qs = new URLSearchParams({ crumb });
  if (dateUnix) qs.set("date", String(dateUnix));
  const url = `https://${host}/v7/finance/options/${encodeURIComponent(ticker)}?${qs.toString()}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, Cookie: cookies },
    signal: AbortSignal.timeout(9000),
  });
  if ((resp.status === 401 || resp.status === 403) && retry) {
    await getYahooCrumb(true);
    return fetchYahooOptionsRaw(ticker, dateUnix, false);
  }
  if (!resp.ok) throw new Error(`Yahoo options ${ticker} HTTP ${resp.status}`);
  const json = await resp.json();
  return json?.optionChain?.result?.[0] || null;
}

function normalizeYahooResult(raw, nowMs = Date.now()) {
  if (!raw) return null;
  const q = raw.quote || {};
  const spot =
    (Number.isFinite(q.regularMarketPrice) && q.regularMarketPrice > 0 ? q.regularMarketPrice : null) ??
    (Number.isFinite(q.postMarketPrice) && q.postMarketPrice > 0 ? q.postMarketPrice : null) ??
    (Number.isFinite(q.preMarketPrice) && q.preMarketPrice > 0 ? q.preMarketPrice : null);
  const expirations = (raw.expirationDates || [])
    .filter((u) => Number.isFinite(u))
    .map((u) => ({ unix: u, date: unixToIso(u), dte: calcDte(u, nowMs) }));
  const opt = raw.options?.[0] || {};
  const selUnix = opt.expirationDate || expirations[0]?.unix || null;
  return {
    source: "yahoo",
    ticker: (raw.underlyingSymbol || q.symbol || "").toUpperCase(),
    name: q.shortName || q.longName || "",
    spot,
    changePct: Number.isFinite(q.regularMarketChangePercent) ? q.regularMarketChangePercent : null,
    prevClose: Number.isFinite(q.regularMarketPreviousClose) ? q.regularMarketPreviousClose : null,
    expirations,
    chain: {
      unix: selUnix,
      date: unixToIso(selUnix),
      dte: calcDte(selUnix, nowMs),
      calls: (opt.calls || []).map(slimYahooContract).filter((c) => c.strike != null),
      puts: (opt.puts || []).map(slimYahooContract).filter((c) => c.strike != null),
    },
  };
}

async function fetchYahooBundle(ticker, { dateUnix = null, wantSwing = true, compact = false } = {}) {
  const key = `${ticker}|${dateUnix || "near"}|${wantSwing ? 1 : 0}|${compact ? 1 : 0}`;
  const cached = cacheGet(_yahooCache, key);
  if (cached) return cached;

  const raw = await fetchYahooOptionsRaw(ticker, dateUnix);
  const base = normalizeYahooResult(raw);
  if (!base || !base.spot) return null;

  let swingChain = null;
  if (wantSwing && !((base.chain?.dte ?? 0) >= 24 && (base.chain?.dte ?? 0) <= 70)) {
    const target = pickSwingExpiration(base.expirations, base.chain?.unix);
    if (target) {
      try {
        const sRaw = await fetchYahooOptionsRaw(ticker, target.unix);
        const sNorm = normalizeYahooResult(sRaw);
        if (sNorm?.chain) swingChain = sNorm.chain;
      } catch { /* ignore */ }
    }
  }

  const payload = {
    source: "yahoo",
    ticker: base.ticker,
    name: base.name,
    spot: base.spot,
    changePct: base.changePct,
    prevClose: base.prevClose,
    expirations: base.expirations,
    selected: compact ? compactChainForScan(base.chain, base.spot) : base.chain,
    swingChain: swingChain ? (compact ? compactChainForScan(swingChain, base.spot) : swingChain) : null,
    asOf: new Date().toISOString(),
  };
  cacheSet(_yahooCache, key, payload, compact ? SCAN_TTL_MS : CHAIN_TTL_MS);
  return payload;
}

// ── Unified Fetch: Cboe first, Yahoo fallback ────────────────────────────────
async function fetchTickerBundle(ticker, opts = {}) {
  try {
    const full = await fetchCboeFull(ticker, opts.compact ? SCAN_TTL_MS : CHAIN_TTL_MS);
    if (full) return sliceCboeBundle(full, opts);
  } catch { /* fall through to Yahoo */ }
  return fetchYahooBundle(ticker, opts);
}

async function runPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const cur = idx++;
      try {
        out[cur] = await fn(items[cur]);
      } catch {
        out[cur] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireAuth(req, res)) return;

  const { mode, ticker: tickerRaw, date: dateRaw, tickers: tickersRaw, swing } = req.query || {};

  // ── Route 1: Multi-ticker batch scan (Swing Call Finder + Unusual Flow) ──
  if (mode === "scan") {
    const list = String(tickersRaw || "")
      .split(",")
      .map((t) => t.trim().toUpperCase())
      .filter((t) => /^[A-Z0-9.-]{1,10}$/.test(t));
    const unique = [...new Set(list)].slice(0, 24);
    if (!unique.length) {
      return res.status(400).json({ error: "tickers query param required (comma-separated, up to 24)" });
    }
    try {
      const results = await runPool(unique, 6, (t) =>
        fetchTickerBundle(t, { wantSwing: swing !== "0", compact: true })
      );
      res.setHeader("Cache-Control", "private, max-age=30");
      return res.status(200).json({
        items: results.filter(Boolean),
        requested: unique.length,
        asOf: new Date().toISOString(),
      });
    } catch (e) {
      return res.status(502).json({ error: e.message || "Options batch scan failed" });
    }
  }

  // ── Route 2: Single-ticker full option chain ─────────────────────────────
  const ticker = String(tickerRaw || "").trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9.-]{1,10}$/.test(ticker)) {
    return res.status(400).json({ error: "Valid ticker query param required" });
  }
  const dateUnix = dateRaw && /^\d{9,12}$/.test(String(dateRaw)) ? Number(dateRaw) : null;
  const wantSwing = swing !== "0";

  try {
    const bundle = await fetchTickerBundle(ticker, { dateUnix, wantSwing, compact: false });
    if (!bundle) {
      return res.status(404).json({ error: `No options chain available for ${ticker}` });
    }
    res.setHeader("Cache-Control", "private, max-age=30");
    return res.status(200).json(bundle);
  } catch (e) {
    return res.status(502).json({ error: e.message || `Options lookup failed for ${ticker}` });
  }
}
