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
let _lastHeaders = [];

function parseCSV(text, label) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  if (label) {
    _lastHeaders = headers;
    console.log(`CSV headers [${label}]:`, headers.join(" | "));
  }
  if (label && lines.length > 1) console.log(`CSV row 1 [${label}]:`, parseCSVLine(lines[1]).join(" | "));
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


// ── Normalize Finviz Elite CSV header names to short keys ──
function normalizeRow(r) {
  return {
    // Direct mappings
    "Ticker": r["Ticker"],
    "Company": r["Company"],
    "Sector": r["Sector"],
    "Industry": r["Industry"],
    "Market Cap": r["Market Cap"],
    "P/E": r["P/E"],
    // Price/Change - try both old and new names
    "Price": r["Price"] || r["Current Price"],
    "Open": r["Open"] || r["Open Price"],
    "Change": r["Change"] || r["Change (%)"],
    "Change from Open": r["Change from Open"] || r["Change From Open"] || r["Change from Open (%)"] || r["From Open"] || r["Open Change"],
    "Gap": r["Gap"] || r["Gap (%)"],
    "Volume": r["Volume"],
    "Avg Volume": r["Avg Volume"] || r["Average Volume"],
    "Rel Volume": r["Rel Volume"] || r["Relative Volume"],
    // Performance
    "Perf Week": r["Perf Week"] || r["Performance (Week)"],
    "Perf Month": r["Perf Month"] || r["Performance (Month)"],
    "Perf Quart": r["Perf Quart"] || r["Performance (Quarter)"] || r["Performance (Quart)"],
    // Technicals
    "ATR": r["ATR"] || r["Average True Range"],
    "RSI": r["RSI"] || r["Relative Strength Index (14)"] || r["RSI (14)"],
    "SMA20": r["SMA20"] || r["20-Day Simple Moving Average"],
    "SMA50": r["SMA50"] || r["50-Day Simple Moving Average"],
    "SMA200": r["SMA200"] || r["200-Day Simple Moving Average"],
    "52W High": r["52W High"] || r["52-Week High"],
    "52W Low": r["52W Low"] || r["52-Week Low"],
    "50D High": r["50D High"] || r["50-Day High"],
    "Earnings Date": r["Earnings Date"] || r["Earnings"],
  };
}

// ── Fetch watchlist quotes ──
async function fetchWatchlist(cookies, tickers) {
  if (!tickers || tickers.length === 0) return [];

  // Don't specify columns — let Finviz return defaults, we'll map by name
  const tickerStr = tickers.join(",");
  const url = `${FINVIZ_EXPORT_URL}?v=152&t=${tickerStr}`;

  try {
    const resp = await fetch(url, {
      headers: { ...HEADERS, Cookie: cookies },
    });

    if (!resp.ok) {
      console.error(`Watchlist fetch failed: ${resp.status}`);
      return [];
    }

    const ct = resp.headers.get("content-type") || "";
    if (ct.includes("html")) {
      console.error("Got HTML instead of CSV for watchlist");
      return [];
    }

    const text = await resp.text();
    const rows = parseCSV(text);

    return rows.map((raw) => {
      const r = normalizeRow(raw);
      return {
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
        perf_week: pct(r["Perf Week"]),
        perf_month: pct(r["Perf Month"]),
        perf_quart: pct(r["Perf Quart"]),
        atr: num(r["ATR"]),
        rsi: num(r["RSI"]),
        sma20: pct(r["SMA20"]),
        sma50: pct(r["SMA50"]),
        sma200: pct(r["SMA200"]),
        high_52w: pct(r["52W High"]),
        pe: num(r["P/E"]),
        earnings: r["Earnings Date"],
      };
    });
  } catch (err) {
    console.error("Watchlist fetch error:", err.message);
    return [];
  }
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
  const url = `${FINVIZ_EXPORT_URL}?v=152&s=ta_topgainers&f=cap_midover&o=-change`;

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

  return rows.slice(0, 50).map((raw) => {
    const r = normalizeRow(raw);
    return {
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
      perf_week: pct(r["Perf Week"]),
      perf_month: pct(r["Perf Month"]),
      perf_quart: pct(r["Perf Quart"]),
      atr: num(r["ATR"]),
      high_52w: pct(r["52W High"]),
      rsi: num(r["RSI"]),
    };
  });
}

// ── Fetch theme universe bulk change% ──
async function fetchThemeUniverse(cookies, tickers) {
  if (!tickers || tickers.length === 0) return [];

  const results = [];
  const batchSize = 200;
  const MAX_RETRIES = 3;

  async function fetchBatch(batch, attempt = 1) {
    const tickerStr = batch.join(",");
    const url = `${FINVIZ_EXPORT_URL}?v=152&t=${tickerStr}`;

    try {
      const resp = await fetch(url, { headers: { ...HEADERS, Cookie: cookies } });

      if (resp.status === 429) {
        if (attempt <= MAX_RETRIES) {
          const wait = 2000 * attempt;
          console.log(`Theme batch 429, retry ${attempt}/${MAX_RETRIES} after ${wait}ms`);
          await new Promise(r => setTimeout(r, wait));
          return fetchBatch(batch, attempt + 1);
        }
        console.error(`Theme batch failed after ${MAX_RETRIES} retries (429)`);
        return [];
      }

      if (!resp.ok) {
        if (attempt <= MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
          return fetchBatch(batch, attempt + 1);
        }
        console.error(`Theme batch failed: ${resp.status}`);
        return [];
      }

      const ct = resp.headers.get("content-type") || "";
      if (ct.includes("html")) {
        if (attempt <= MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 1500 * attempt));
          return fetchBatch(batch, attempt + 1);
        }
        console.error("Theme batch returned HTML after retries");
        return [];
      }

      const text = await resp.text();
      const rows = parseCSV(text);
      return rows.map(raw => {
        const r = normalizeRow(raw);
        return {
          ticker: r["Ticker"], price: num(r["Price"]), change: pct(r["Change"]),
          volume: r["Volume"], avg_volume: r["Avg Volume"],
          rel_volume: num(r["Rel Volume"]),
        };
      });
    } catch (err) {
      if (attempt <= MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
        return fetchBatch(batch, attempt + 1);
      }
      console.error(`Theme batch error after retries:`, err.message);
      return [];
    }
  }

  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    if (i > 0) await new Promise(r => setTimeout(r, 600));
    const batchResults = await fetchBatch(batch);
    results.push(...batchResults);
  }

  console.log(`Theme universe: ${results.length}/${tickers.length} tickers fetched`);
  return results;
}

// ── Fetch premarket/afterhours movers ──
async function fetchPremarketMovers(cookies) {
  const url = `${FINVIZ_EXPORT_URL}?v=152&f=cap_midover,ta_gap_u1&o=-gap`;

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

  return rows.slice(0, 30).map((raw) => {
    const r = normalizeRow(raw);
    return {
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
      high_52w: pct(r["52W High"]),
      rsi: num(r["RSI"]),
      atr: num(r["ATR"]),
    };
  });
}

// ── Fetch ticker news from Finviz quote page ──
async function fetchTickerNews(cookies, ticker) {
  try {
    const url = `https://elite.finviz.com/quote.ashx?t=${ticker}`;
    const resp = await fetch(url, { headers: { ...HEADERS, Cookie: cookies } });
    if (!resp.ok) return [];
    const html = await resp.text();
    
    // Finviz news table uses class "news-link-left" or id "news-table"
    // Each row: <td>date/time</td><td><a href="url" class="tab-link-news">headline</a> source</td>
    const news = [];
    
    // Find the news table section
    const newsTableIdx = html.indexOf('news-table');
    if (newsTableIdx === -1) {
      console.log(`News: no news-table found for ${ticker}`);
      return [];
    }
    
    // Extract rows from the news table
    const section = html.substring(newsTableIdx, newsTableIdx + 10000);
    const rowRegex = /<tr[^>]*>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<\/tr>/gs;
    let match;
    while ((match = rowRegex.exec(section)) !== null && news.length < 3) {
      const dateCell = match[1].replace(/<[^>]+>/g, '').trim();
      const contentCell = match[2];
      
      // Extract URL and headline from anchor tag
      const linkMatch = contentCell.match(/href="([^"]+)"[^>]*>([^<]+)<\/a>/);
      if (!linkMatch) continue;
      
      const articleUrl = linkMatch[1];
      const headline = linkMatch[2].trim();
      
      // Extract source (usually after the closing </a> tag)
      const sourceMatch = contentCell.match(/<\/a>\s*(?:<[^>]+>)?\s*([^<]+)/);
      const source = sourceMatch ? sourceMatch[1].trim().replace(/[()]/g, '') : '';
      
      news.push({ date: dateCell, headline, url: articleUrl, source });
    }
    
    console.log(`News for ${ticker}: ${news.length} items`);
    return news;
  } catch (err) {
    console.error(`News fetch error for ${ticker}:`, err.message);
    return [];
  }
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

    // Fetch watchlist tickers
    const watchlist = watchlistTickers.length > 0
      ? await fetchWatchlist(cookies, watchlistTickers)
      : [];

    // Fetch theme universe (many batches, needs rate limit spacing)
    const themeUniverse = universeTickers.length > 0
      ? await fetchThemeUniverse(cookies, universeTickers)
      : [];

    // Fetch news for a single ticker if requested
    const newsTicker = (req.query.news || "").trim().toUpperCase();
    const news = newsTicker ? await fetchTickerNews(cookies, newsTicker) : null;

    return res.status(200).json({
      ok: true,
      timestamp: new Date().toISOString(),
      watchlist,
      theme_universe: themeUniverse,
      news,
    });
  } catch (err) {
    console.error("Live API error:", err);
    return res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
}
