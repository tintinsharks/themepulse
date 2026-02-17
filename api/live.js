// api/live.js — Vercel Serverless Function
// Fetches real-time quotes from Finviz Elite for:
//   1. Watchlist tickers (passed via ?tickers=AAPL,NVDA,PLTR)
//   2. Top volume gainers (relative volume > 2x)
//
// Env vars required in Vercel:
//   FINVIZ_EMAIL
//   FINVIZ_PASSWORD

const FINVIZ_LOGIN_URL = "https://finviz.com/login_submit.ashx";
const FINVIZ_SCREENER_URL = "https://elite.finviz.com/screener.ashx";
const FINVIZ_EXPORT_URL = "https://elite.finviz.com/export.ashx";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

// ── Cookie-based session login ──
let cachedCookies = null;
let cookieExpiry = 0;

async function loginFinviz() {
  // Reuse cookies for 10 minutes
  if (cachedCookies && Date.now() < cookieExpiry) {
    return cachedCookies;
  }

  // Priority 1: Use raw FINVIZ_COOKIES if set (most reliable)
  const rawCookies = process.env.FINVIZ_COOKIES;
  if (rawCookies && rawCookies.length > 20) {
    console.log("Using FINVIZ_COOKIES env var (" + rawCookies.length + " chars)");
    cachedCookies = rawCookies;
    cookieExpiry = Date.now() + 10 * 60 * 1000;
    return cachedCookies;
  }

  // Priority 2: Login with email/password
  const email = process.env.FINVIZ_EMAIL;
  const password = process.env.FINVIZ_PASSWORD;
  if (!email || !password) {
    throw new Error("Set FINVIZ_COOKIES or FINVIZ_EMAIL+FINVIZ_PASSWORD env vars");
  }

  console.log("Attempting Finviz login with email:", email);

  // Step 1: Hit screener to get initial cookies
  const initResp = await fetch(FINVIZ_SCREENER_URL, {
    headers: HEADERS,
    redirect: "manual",
  });
  let cookies = extractCookies(initResp);
  console.log("Init cookies:", cookies ? cookies.substring(0, 80) : "NONE");

  // Step 2: Login
  const body = new URLSearchParams({ email, password });
  const loginResp = await fetch(FINVIZ_LOGIN_URL, {
    method: "POST",
    headers: {
      ...HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookies,
    },
    body: body.toString(),
    redirect: "manual",
  });

  console.log("Login status:", loginResp.status);

  // Merge cookies
  const loginCookies = extractCookies(loginResp);
  cookies = mergeCookies(cookies, loginCookies);
  console.log("Final cookies:", cookies ? cookies.substring(0, 80) : "NONE");

  cachedCookies = cookies;
  cookieExpiry = Date.now() + 10 * 60 * 1000;

  return cookies;
}

function extractCookies(resp) {
  const setCookies = resp.headers.getSetCookie?.() || [];
  return setCookies.map((c) => c.split(";")[0]).join("; ");
}

function mergeCookies(existing, fresh) {
  const map = {};
  (existing || "").split("; ").forEach((c) => {
    const [k, ...v] = c.split("=");
    if (k) map[k.trim()] = v.join("=");
  });
  (fresh || "").split("; ").forEach((c) => {
    const [k, ...v] = c.split("=");
    if (k) map[k.trim()] = v.join("=");
  });
  return Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

// ── CSV parsing ──
function parseCSV(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map((line) => {
    const vals = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => (obj[h] = vals[i] || ""));
    return obj;
  });
}

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function pct(v) {
  if (!v || v === "-") return null;
  return parseFloat(String(v).replace("%", ""));
}

function num(v) {
  if (!v || v === "-") return null;
  return parseFloat(String(v).replace(/,/g, ""));
}

function parseVolume(v) {
  if (!v || v === "-") return null;
  const s = String(v).trim().replace(/,/g, "");
  // Handle suffixes: K, M, B
  const upper = s.toUpperCase();
  if (upper.endsWith("B")) return parseFloat(s) * 1e9;
  if (upper.endsWith("M")) return parseFloat(s) * 1e6;
  if (upper.endsWith("K")) return parseFloat(s) * 1e3;
  return parseFloat(s);
}

// ── Zanger Volume Ratio (ZVR) ──
// U-shaped intraday volume curve: cumulative % of daily volume by time
// Based on empirical US equity market patterns (30-min buckets, 9:30-4:00)
const INTRADAY_CUMULATIVE = [
  [570, 0.00],   // 9:30 — market open
  [600, 0.12],   // 10:00
  [630, 0.20],   // 10:30
  [660, 0.26],   // 11:00
  [690, 0.31],   // 11:30
  [720, 0.35],   // 12:00
  [750, 0.39],   // 12:30
  [780, 0.42],   // 1:00
  [810, 0.46],   // 1:30
  [840, 0.49],   // 2:00
  [870, 0.53],   // 2:30
  [900, 0.58],   // 3:00
  [930, 0.65],   // 3:30
  [960, 1.00],   // 4:00 — market close
];

function getCumulativeWeight() {
  // Get current ET time using UTC offset
  // ET is UTC-5 (EST) or UTC-4 (EDT)
  const now = new Date();
  const utcMonth = now.getUTCMonth(); // 0-11
  const utcDate = now.getUTCDate();
  const utcDay = now.getUTCDay(); // 0=Sun

  // Simple DST check: EDT is 2nd Sun Mar to 1st Sun Nov
  // March: DST starts 2nd Sunday
  // November: DST ends 1st Sunday
  let isDST = false;
  if (utcMonth > 2 && utcMonth < 10) {
    isDST = true; // Apr-Oct always EDT
  } else if (utcMonth === 2) {
    // March: find 2nd Sunday
    const firstDay = new Date(Date.UTC(now.getUTCFullYear(), 2, 1)).getUTCDay();
    const secondSunday = firstDay === 0 ? 8 : (14 - firstDay + 1);
    isDST = utcDate >= secondSunday;
  } else if (utcMonth === 10) {
    // November: find 1st Sunday
    const firstDay = new Date(Date.UTC(now.getUTCFullYear(), 10, 1)).getUTCDay();
    const firstSunday = firstDay === 0 ? 1 : (7 - firstDay + 1);
    isDST = utcDate < firstSunday;
  }

  const etOffset = isDST ? -4 : -5;
  const etHour = (now.getUTCHours() + etOffset + 24) % 24;
  const etMinute = now.getUTCMinutes();
  const mins = etHour * 60 + etMinute;

  // Weekend check (in ET)
  let etDay = now.getUTCDay();
  if (now.getUTCHours() + etOffset < 0) etDay = (etDay + 6) % 7;
  if (etDay === 0 || etDay === 6) return 1.0; // Sat/Sun

  if (mins <= 570) return 1.0;     // before 9:30 ET — use simple ratio
  if (mins >= 960) return 1.0;     // after 4:00 ET

  // Interpolate between buckets
  for (let i = 1; i < INTRADAY_CUMULATIVE.length; i++) {
    const [t1, w1] = INTRADAY_CUMULATIVE[i - 1];
    const [t2, w2] = INTRADAY_CUMULATIVE[i];
    if (mins <= t2) {
      const frac = (mins - t1) / (t2 - t1);
      return w1 + frac * (w2 - w1);
    }
  }
  return 1.0;
}

function calcZVR(volumeStr, avgVolumeStr) {
  const vol = parseVolume(volumeStr);
  const avgVol = parseVolume(avgVolumeStr);
  if (!vol || !avgVol || avgVol === 0) return null;

  const cumWeight = getCumulativeWeight();

  // After market close or before open: use simple ratio
  if (cumWeight >= 1.0 || cumWeight <= 0.01) {
    return Math.round((vol / avgVol) * 100);
  }

  // During market hours: project end-of-day volume using U-curve
  const projectedVol = vol / cumWeight;
  return Math.round((projectedVol / avgVol) * 100);
}

// ── Fetch watchlist quotes ──
async function fetchWatchlist(cookies, tickers) {
  if (!tickers || tickers.length === 0) return [];

  // Finviz export with ticker filter
  // Use custom view with key columns
  const cols = "1,2,3,4,6,7,43,44,45,46,47,48,49,50,55,57,58,59,62,64";
  // Ticker,Company,Sector,Industry,MarketCap,P/E,Price,Change,Volume,AvgVolume,RelVolume,
  // PerfWeek,PerfMonth,PerfQuart,ATR,SMA20,SMA50,SMA200,52WHigh,RSI

  // Finviz doesn't have a direct ticker filter in export — use the screener page
  // For watchlist, fetch individual stock pages or use the full export and filter
  // Most efficient: fetch full export once, filter client-side
  // But for small watchlists, we can use the quote page

  // Use bulk approach: fetch quote data for each ticker via finviz quote API
  const results = [];
  const batchSize = 20;

  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    const promises = batch.map(async (ticker) => {
      try {
        const resp = await fetch(
          `https://elite.finviz.com/quote.ashx?t=${encodeURIComponent(ticker)}&p=d`,
          {
            headers: { ...HEADERS, Cookie: cookies },
          }
        );
        if (!resp.ok) return null;
        const html = await resp.text();
        return parseQuotePage(ticker, html);
      } catch {
        return null;
      }
    });
    const batchResults = await Promise.all(promises);
    results.push(...batchResults.filter(Boolean));
  }

  return results;
}

function parseQuotePage(ticker, html) {
  // Extract key data from the snapshot table on finviz quote page
  const get = (label) => {
    // Pattern: <td ...>Label</td><td ...><b>Value</b></td>
    const re = new RegExp(
      `<td[^>]*>\\s*${label}\\s*</td>\\s*<td[^>]*><b[^>]*>([^<]*)</b>`,
      "i"
    );
    const m = html.match(re);
    return m ? m[1].trim() : null;
  };

  // Get company name from title
  const titleMatch = html.match(/<title>([^|]*)\|/);
  const company = titleMatch ? titleMatch[1].trim() : ticker;

  // Get sector
  const sectorMatch = html.match(
    /class="tab-link"[^>]*>([^<]+)<\/a>\s*\|\s*<a[^>]*class="tab-link"[^>]*>([^<]+)<\/a>\s*\|\s*<a/
  );

  return {
    ticker,
    company: company.replace(` (${ticker})`, "").replace(` Stock`, ""),
    sector: sectorMatch ? sectorMatch[1] : null,
    industry: sectorMatch ? sectorMatch[2] : null,
    price: num(get("Price")),
    change: pct(get("Change")),
    volume: get("Volume"),
    avg_volume: get("Avg Volume"),
    rel_volume: num(get("Rel Volume")),
    zvr: calcZVR(get("Volume"), get("Avg Volume")),
    perf_week: pct(get("Perf Week")),
    perf_month: pct(get("Perf Month")),
    perf_quart: pct(get("Perf Quarter")),
    atr: num(get("ATR")),
    rsi: num(get("RSI \\(14\\)")),
    sma20: pct(get("SMA20")),
    sma50: pct(get("SMA50")),
    sma200: pct(get("SMA200")),
    high_52w: pct(get("52W High")),
    pe: num(get("P/E")),
    market_cap: get("Market Cap"),
    earnings: get("Earnings"),
  };
}

// ── Fetch top gainers ──
async function fetchTopGainers(cookies) {
  // Finviz "Top Gainers" signal + mid cap and above
  const cols = "1,2,3,4,6,43,44,45,46,47,48,49,50,55,62,64";
  const url = `${FINVIZ_EXPORT_URL}?v=152&s=ta_topgainers&f=cap_midover&o=-change&c=${cols}`;

  const resp = await fetch(url, {
    headers: { ...HEADERS, Cookie: cookies },
  });

  if (!resp.ok) {
    console.error(`Top gainers fetch failed: ${resp.status}`);
    return [];
  }

  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("html")) {
    console.error("Got HTML instead of CSV for top gainers");
    return [];
  }

  const text = await resp.text();
  const rows = parseCSV(text);

  return rows.slice(0, 50).map((r) => ({
    ticker: r["Ticker"],
    company: r["Company"],
    sector: r["Sector"],
    industry: r["Industry"],
    market_cap: r["Market Cap"],
    price: num(r["Price"]),
    change: pct(r["Change"]),
    volume: r["Volume"],
    avg_volume: r["Avg Volume"],
    rel_volume: num(r["Rel Volume"]),
    zvr: calcZVR(r["Volume"], r["Avg Volume"]),
    perf_week: pct(r["Perf Week"]),
    perf_month: pct(r["Perf Month"]),
    perf_quart: pct(r["Perf Quart"]),
    atr: num(r["ATR"]),
    high_52w: pct(r["52W High"]),
    rsi: num(r["RSI"]),
  }));
}

// ── Fetch theme universe bulk change% ──
async function fetchThemeUniverse(cookies, tickers) {
  if (!tickers || tickers.length === 0) return [];

  // Finviz export with ticker filter: t=AAPL,NVDA,MSFT,...
  // Columns: Ticker(1), Price(62), Change(64), Volume(48), Avg Volume(49), Rel Volume(50), Gap(60)
  const cols = "1,62,64,48,49,50,60";

  // Finviz has a URL length limit, batch into groups of ~100 tickers
  const results = [];
  const batchSize = 100;

  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    const tickerStr = batch.join(",");
    const url = `${FINVIZ_EXPORT_URL}?v=152&t=${tickerStr}&c=${cols}`;

    try {
      const resp = await fetch(url, {
        headers: { ...HEADERS, Cookie: cookies },
      });

      if (!resp.ok) {
        console.error(`Theme universe batch ${i} fetch failed: ${resp.status}`);
        continue;
      }

      const ct = resp.headers.get("content-type") || "";
      if (ct.includes("html")) {
        console.error("Got HTML instead of CSV for theme universe batch");
        continue;
      }

      const text = await resp.text();
      const rows = parseCSV(text);

      rows.forEach((r) => {
        results.push({
          ticker: r["Ticker"],
          price: num(r["Price"]),
          change: pct(r["Change"]),
          gap: pct(r["Gap"]),
          volume: r["Volume"],
          avg_volume: r["Avg Volume"],
          rel_volume: num(r["Rel Volume"]),
        });
      });
    } catch (err) {
      console.error(`Theme universe batch ${i} error:`, err.message);
    }
  }

  return results;
}

// ── Fetch premarket/afterhours movers ──
async function fetchPremarketMovers(cookies) {
  // Finviz screener sorted by gap%, mid cap+, gap up > 1%
  // Columns: Ticker(1), Company(2), Sector(3), Industry(4), Market Cap(6), Price(62), Change(64), Gap(60), Volume(48), Avg Volume(49), Rel Volume(50), ATR(55), 52W High(46), RSI(43)
  const cols = "1,2,3,4,6,62,64,60,48,49,50,55,46,43";
  const url = `${FINVIZ_EXPORT_URL}?v=152&f=cap_midover,ta_gap_u1&o=-gap&c=${cols}`;

  const resp = await fetch(url, {
    headers: { ...HEADERS, Cookie: cookies },
  });

  if (!resp.ok) {
    console.error(`Premarket movers fetch failed: ${resp.status}`);
    return [];
  }

  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("html")) {
    console.error("Got HTML instead of CSV for premarket movers");
    return [];
  }

  const text = await resp.text();
  const rows = parseCSV(text);

  return rows.slice(0, 30).map((r) => ({
    ticker: r["Ticker"],
    company: r["Company"],
    sector: r["Sector"],
    industry: r["Industry"],
    market_cap: r["Market Cap"],
    price: num(r["Price"]),
    change: pct(r["Change"]),
    gap: pct(r["Gap"]),
    volume: r["Volume"],
    avg_volume: r["Avg Volume"],
    rel_volume: num(r["Rel Volume"]),
    zvr: calcZVR(r["Volume"], r["Avg Volume"]),
    high_52w: pct(r["52W High"]),
    rsi: num(r["RSI"]),
    atr: num(r["ATR"]),
  }));
}

// ── Handler ──
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const cookies = await loginFinviz();

    // Parse watchlist tickers from query
    const tickerParam = req.query.tickers || "";
    const watchlistTickers = tickerParam
      ? tickerParam
          .split(",")
          .map((t) => t.trim().toUpperCase())
          .filter(Boolean)
          .slice(0, 30) // cap at 30
      : [];

    // Parse theme universe tickers (for live rotation)
    const universeParam = req.query.universe || "";
    const universeTickers = universeParam
      ? universeParam
          .split(",")
          .map((t) => t.trim().toUpperCase())
          .filter(Boolean)
      : [];

    // Fetch all in parallel
    const [watchlist, topGainers, premarketMovers, themeUniverse] = await Promise.all([
      watchlistTickers.length > 0
        ? fetchWatchlist(cookies, watchlistTickers)
        : Promise.resolve([]),
      fetchTopGainers(cookies),
      fetchPremarketMovers(cookies),
      universeTickers.length > 0
        ? fetchThemeUniverse(cookies, universeTickers)
        : Promise.resolve([]),
    ]);

    return res.status(200).json({
      ok: true,
      timestamp: new Date().toISOString(),
      watchlist,
      top_gainers: topGainers,
      premarket_movers: premarketMovers,
      theme_universe: themeUniverse,
    });
  } catch (err) {
    console.error("Live API error:", err);
    return res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
}
