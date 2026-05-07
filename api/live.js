// api/live.js — Vercel Serverless Function
// Fetches real-time quotes from Finviz Elite for:
//   1. Watchlist tickers (passed via ?tickers=AAPL,NVDA,PLTR)
//   2. Top volume gainers (relative volume > 2x)
//
// Env vars required in Vercel:
//   FINVIZ_EMAIL
//   FINVIZ_PASSWORD

export const config = { maxDuration: 30 };

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

// ── Fetch watchlist quotes (FMP primary, Finviz fallback) ──
async function fetchWatchlist(cookies, tickers) {
  if (!tickers || tickers.length === 0) return [];

  const fmpKey = process.env.FMP_API_KEY;
  if (fmpKey) {
    return fetchWatchlistFmp(tickers, fmpKey);
  }
  // Fallback to Finviz if no FMP key
  return fetchWatchlistFinviz(cookies, tickers);
}

async function fetchWatchlistFmp(tickers, apiKey) {
  const results = [];
  const BATCH = 500;
  const MAX_RETRIES = 2;

  for (let i = 0; i < tickers.length; i += BATCH) {
    const batch = tickers.slice(i, i + BATCH);
    const symbolStr = batch.join(",");

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const url = `${FMP_BASE}/batch-quote?symbols=${symbolStr}&apikey=${apiKey}`;
        const resp = await fetch(url);
        if (!resp.ok) {
          console.error(`FMP watchlist batch failed: ${resp.status}`);
          if (attempt < MAX_RETRIES) { await new Promise(r => setTimeout(r, 1000)); continue; }
          break;
        }
        const data = await resp.json();
        if (!Array.isArray(data)) break;

        data.filter(q => q.symbol).forEach(q => {
          results.push({
            ticker: q.symbol,
            company: q.name || q.symbol,
            price: q.price ?? null,
            change: q.changePercentage ?? null,
            gap: q.previousClose && q.open
              ? Math.round(((q.open - q.previousClose) / q.previousClose) * 10000) / 100
              : null,
            volume: q.volume ?? null,
            avgVolume: q.avgVolume ?? null,
            open: q.open ?? null,
            dayHigh: q.dayHigh ?? null,
            dayLow: q.dayLow ?? null,
            previousClose: q.previousClose ?? null,
            market_cap: q.marketCap != null ? String(q.marketCap) : null,
          });
        });
        break; // success
      } catch (err) {
        console.error(`FMP watchlist error: ${err.message}`);
        if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 1000));
      }
    }
    if (i + BATCH < tickers.length) await new Promise(r => setTimeout(r, 100));
  }

  console.log(`FMP Watchlist: ${results.length}/${tickers.length} tickers fetched`);
  return results;
}

async function fetchWatchlistFinviz(cookies, tickers) {
  const results = [];
  const batchSize = 50;
  const MAX_RETRIES = 3;

  async function fetchBatch(batch, attempt = 1) {
    const tickerStr = batch.join(",");
    const url = `${FINVIZ_EXPORT_URL}?v=152&t=${tickerStr}`;

    try {
      const resp = await fetch(url, {
        headers: { ...HEADERS, Cookie: cookies },
      });

      if (resp.status === 429) {
        if (attempt <= MAX_RETRIES) {
          const wait = 2000 * attempt;
          console.log(`Watchlist batch 429, retry ${attempt}/${MAX_RETRIES} after ${wait}ms`);
          await new Promise(r => setTimeout(r, wait));
          return fetchBatch(batch, attempt + 1);
        }
        console.error(`Watchlist batch failed after ${MAX_RETRIES} retries (429)`);
        return [];
      }

      if (!resp.ok) {
        console.error(`Watchlist fetch failed: ${resp.status}`);
        if (attempt <= MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
          return fetchBatch(batch, attempt + 1);
        }
        return [];
      }

      const ct = resp.headers.get("content-type") || "";
      if (ct.includes("html")) {
        console.error("Got HTML instead of CSV for watchlist");
        if (attempt <= MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 1500 * attempt));
          return fetchBatch(batch, attempt + 1);
        }
        return [];
      }

      const text = await resp.text();
      const rows = parseCSV(text, attempt === 1 && results.length === 0 ? "watchlist" : null);

      const parsed = rows.map((raw) => {
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

      return parsed;
    } catch (err) {
      console.error("Watchlist fetch error:", err.message);
      if (attempt <= MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
        return fetchBatch(batch, attempt + 1);
      }
      return [];
    }
  }

  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    if (i > 0) await new Promise(r => setTimeout(r, 600));
    const batchResults = await fetchBatch(batch);
    results.push(...batchResults);
  }

  console.log(`Finviz Watchlist: ${results.length}/${tickers.length} tickers fetched`);
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
    if (!resp.ok) return { news: [], peers: [], description: "", earningsData: {}, quarters: [], analyst: {} };
    const html = await resp.text();
    
    // ── NEWS ──
    const news = [];
    const newsTableIdx = html.indexOf('news-table');
    if (newsTableIdx !== -1) {
      const section = html.substring(newsTableIdx, newsTableIdx + 15000);
      const rowRegex = /<tr[^>]*>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<\/tr>/gs;
      let match;
      while ((match = rowRegex.exec(section)) !== null && news.length < 5) {
        const dateCell = match[1].replace(/<[^>]+>/g, '').trim();
        const contentCell = match[2];
        const linkMatch = contentCell.match(/href="([^"]+)"[^>]*>([^<]+)<\/a>/);
        if (!linkMatch) continue;
        const articleUrl = linkMatch[1];
        const headline = linkMatch[2].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
        const sourceMatch = contentCell.match(/<\/a>\s*(?:<[^>]+>)?\s*([^<]+)/);
        const source = sourceMatch ? sourceMatch[1].trim().replace(/[()]/g, '') : '';
        news.push({ date: dateCell, headline, url: articleUrl, source });
      }
    }
    
    // ── PEERS ──
    // Finviz peers section: links with class "tab-link" near text "Peers" or in a peers row
    // Pattern: <td class="body-table-rating-col">Peers</td> ... <a href="quote.ashx?t=TICKER" class="tab-link">TICKER</a>
    const peers = [];
    const peersIdx = html.indexOf('>Peers<');
    if (peersIdx !== -1) {
      const peersSection = html.substring(peersIdx, peersIdx + 2000);
      const peerRegex = /quote\.ashx\?t=([A-Z]+)[^>]*class="tab-link"[^>]*>([A-Z]+)<\/a>/g;
      let peerMatch;
      while ((peerMatch = peerRegex.exec(peersSection)) !== null) {
        const peerTicker = peerMatch[2].trim();
        if (peerTicker !== ticker && !peers.includes(peerTicker)) {
          peers.push(peerTicker);
        }
      }
    }
    // Fallback: try alternate pattern where class comes before href
    if (peers.length === 0) {
      const peersIdx2 = html.indexOf('Peers');
      if (peersIdx2 !== -1) {
        const peersSection2 = html.substring(peersIdx2, peersIdx2 + 2000);
        const peerRegex2 = /class="tab-link"[^>]*href="quote\.ashx\?t=([A-Z]+)"[^>]*>([A-Z]+)<\/a>/g;
        let pm2;
        while ((pm2 = peerRegex2.exec(peersSection2)) !== null) {
          const pt = pm2[2].trim();
          if (pt !== ticker && !peers.includes(pt)) peers.push(pt);
        }
      }
    }
    // Fallback 2: just grab all tickers after "Peers" text
    if (peers.length === 0) {
      const pi3 = html.indexOf('Peers');
      if (pi3 !== -1) {
        const ps3 = html.substring(pi3, pi3 + 2000);
        const pr3 = /t=([A-Z]{1,5})"[^>]*>([A-Z]{1,5})<\/a>/g;
        let pm3;
        while ((pm3 = pr3.exec(ps3)) !== null) {
          const pt = pm3[2].trim();
          if (pt !== ticker && !peers.includes(pt) && pt.length <= 5) peers.push(pt);
        }
      }
    }
    
    console.log(`News for ${ticker}: ${news.length} items, Peers: ${peers.length}`);
    
    // ── PROFILE DESCRIPTION ──
    let description = '';
    // Finviz profile description is in a td with class containing "profile" or in the fullview-profile div
    const profilePatterns = [
      /class="[^"]*profile[^"]*"[^>]*>([\s\S]*?)<\/td>/i,
      /id="[^"]*profile[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div)>/i,
      /class="body-table-profile"[^>]*>([\s\S]*?)<\/td>/i,
    ];
    for (const pat of profilePatterns) {
      const m = html.match(pat);
      if (m && m[1]) {
        description = m[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        if (description.length > 20) break;
        description = '';
      }
    }
    // Fallback: look for long text block near "Description" or company profile area
    if (!description) {
      const descIdx = html.indexOf('fullview-profile');
      if (descIdx !== -1) {
        const descSection = html.substring(descIdx, descIdx + 5000);
        const tdMatch = descSection.match(/<td[^>]*>([\s\S]{100,2000}?)<\/td>/);
        if (tdMatch) {
          description = tdMatch[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        }
      }
    }
    
    // Trim last sentence (usually boilerplate like "The company was founded/incorporated/headquartered...")
    if (description) {
      const sentences = description.split(/(?<=\.)\s+/);
      if (sentences.length > 1) {
        sentences.pop();
        description = sentences.join(' ');
      }
    }
    
    // ── QUARTERLY EPS from Finviz snapshot table ──
    // Finviz has EPS (ttm), EPS this Y, EPS next Q, EPS this Q, etc.
    // But the real quarterly data is in the "financial highlights" or earnings estimate table
    // Pattern: rows like "EPS this Y" -> value, "EPS next Y" -> value
    const earningsData = {};
    const epsGet = (label) => {
      const re = new RegExp(`<td[^>]*>\\s*${label}\\s*</td>\\s*<td[^>]*><b[^>]*>([^<]*)</b>`, 'i');
      const m = html.match(re);
      return m ? m[1].trim() : null;
    };
    earningsData.eps_ttm = epsGet('EPS \\(ttm\\)');
    earningsData.eps_this_y = epsGet('EPS this Y');
    earningsData.eps_next_y = epsGet('EPS next Y');
    earningsData.eps_next_5y = epsGet('EPS next 5Y');
    earningsData.eps_past_5y = epsGet('EPS past 5Y');
    earningsData.sales_past_5y = epsGet('Sales past 5Y');
    earningsData.sales_qq = epsGet('Sales Q/Q');
    earningsData.eps_qq = epsGet('EPS Q/Q');
    
    // ── ANALYST CONSENSUS ──
    const analyst = {};
    // Try epsGet first (uses <b> tag pattern), then fallback to broader pattern
    const rawTarget = epsGet('Target Price');
    if (rawTarget) {
      analyst.target_price = rawTarget;
    } else {
      // Broader pattern: look for Target Price in snapshot table with various tag patterns
      const tpMatch = html.match(/Target Price<\/td>\s*<td[^>]*>\s*(?:<[^>]*>)*\s*([\d.,]+)/i);
      if (tpMatch) analyst.target_price = tpMatch[1].trim();
    }
    const rawRecom = epsGet('Recom');
    if (rawRecom) {
      analyst.recommendation = parseFloat(rawRecom);
    } else {
      const recMatch = html.match(/Recom<\/td>\s*<td[^>]*>\s*(?:<[^>]*>)*\s*([\d.]+)/i);
      if (recMatch) analyst.recommendation = parseFloat(recMatch[1]);
    }
    
    // ── QUARTERLY INCOME STATEMENT from FactSet table ──
    // Table class="quote_statements-table" with rows: Total Revenue, EPS (Diluted), etc.
    // Each data cell: <span>value</span> and <span class="...">YoY%</span>
    const quarters = [];
    const statementsIdx = html.indexOf('quote_statements-table');
    if (statementsIdx !== -1) {
      const statementsSection = html.substring(statementsIdx, statementsIdx + 80000);
      
      // Extract period headers (Q4 2025, Q3 2025, etc.)
      const periodLabels = [];
      const periodRow = statementsSection.match(/first-row[\s\S]*?<\/tr>/);
      if (periodRow) {
        const periodRe = />(Q[1-4]\s*\d{4})</g;
        let pm;
        while ((pm = periodRe.exec(periodRow[0])) !== null) {
          periodLabels.push(pm[1]);
        }
      }
      
      if (periodLabels.length >= 4) {
        // Parse a row by label pattern — extract value + yoy from each cell
        const parseRow = (labelPattern) => {
          const re = new RegExp(labelPattern + '[\\s\\S]*?<\\/tr>', 'i');
          const rowMatch = statementsSection.match(re);
          if (!rowMatch) return null;
          const rowHtml = rowMatch[0];
          const cellRe = /<td[^>]*align="right"[^>]*>([\s\S]*?)<\/td>/g;
          const values = [];
          let cm;
          while ((cm = cellRe.exec(rowHtml)) !== null) {
            const cellContent = cm[1];
            const spans = [];
            const spanRe = /<span[^>]*>([^<]*)<\/span>/g;
            let sm;
            while ((sm = spanRe.exec(cellContent)) !== null) {
              const v = sm[1].trim();
              if (v) spans.push(v);
            }
            if (spans.length === 0) {
              const raw = cellContent.replace(/<[^>]+>/g, '').trim();
              if (raw) spans.push(raw);
            }
            values.push({ value: spans[0] || null, yoy: spans.length > 1 ? spans[1] : null });
          }
          return values;
        };
        
        const revenueData = parseRow('Total Revenue');
        const epsData = parseRow('EPS \\(Diluted\\)');
        
        const parseVal = (v) => {
          if (!v || v === '—' || v === '——') return null;
          return parseFloat(v.replace(/,/g, ''));
        };
        const parsePct = (v) => {
          if (!v || v === '—' || v === '——') return null;
          return parseFloat(v.replace(/,/g, '').replace('%', ''));
        };
        
        for (let i = 0; i < periodLabels.length && i < 8; i++) {
          const parts = periodLabels[i].match(/Q(\d)\s*(\d{4})/);
          if (!parts) continue;
          const q = {
            label: `Q${parts[1]}-${parts[2].slice(2)}`,
            period: `Q${parts[1]}`,
            year: parseInt(parts[2]),
          };
          if (revenueData && revenueData[i]) {
            q.revenue = parseVal(revenueData[i].value);
            q.revenue_yoy = parsePct(revenueData[i].yoy);
            if (q.revenue) q.revenue_fmt = q.revenue >= 1000 ? `${(q.revenue/1000).toFixed(1)}B` : `${Math.round(q.revenue)}M`;
          }
          if (epsData && epsData[i]) {
            q.eps = parseVal(epsData[i].value);
            q.eps_yoy = parsePct(epsData[i].yoy);
          }
          quarters.push(q);
        }
      }
    }

    console.log(`News for ${ticker}: ${news.length} items, Peers: ${peers.length}, FactSet quarters: ${quarters.length}`);
    // DEBUG: capture nearby HTML for Target Price / Recom
    const tpIdx = html.indexOf('Target Price');
    if (tpIdx !== -1) {
      analyst._debug = html.substring(tpIdx - 50, tpIdx + 200).replace(/\n/g, ' ');
    } else {
      analyst._debug = 'Target Price NOT FOUND in HTML';
    }
    const recIdx = html.indexOf('Recom');
    analyst._debugRecom = recIdx !== -1 ? html.substring(recIdx - 50, recIdx + 200).replace(/\n/g, ' ') : 'Recom NOT FOUND';

    // ── EARNINGS DATE ──
    // Finviz quote page stats table: <td>Earnings</td><td><b>May 26 AMC</b></td>
    let earningsDate = null;
    const erMatch = html.match(/<td[^>]*>\s*Earnings\s*<\/td>\s*<td[^>]*><b[^>]*>([^<]+)<\/b>/i);
    if (erMatch) earningsDate = erMatch[1].trim();

    return { news, peers, description, earningsData, quarters, analyst, earningsDate };
  } catch (err) {
    console.error(`News/peers fetch error for ${ticker}:`, err.message);
    return { news: [], peers: [], description: "", earningsData: {}, quarters: [], analyst: {} };
  }
}

// ── Fetch Finviz homepage data: futures, earnings, major news ──
async function fetchHomepage(cookies) {
  try {
    const url = cookies ? "https://elite.finviz.com/" : "https://finviz.com/";
    const resp = await fetch(url, { headers: { ...HEADERS, Cookie: cookies } });
    if (!resp.ok) return { futures: [], earnings: [], major_news: [] };
    const html = await resp.text();
    
    // ── FUTURES ──
    // Pattern: <td><a ...class="tab-link">Label</a></td><td...><span...>Last</span></td><td...><span...>Change</span></td><td...><span...>Change%</span></td>
    const futures = [];
    const fRegex = /class="tab-link">([^<]+)<\/a><\/td>\s*<td[^>]*><span[^>]*>([\d.,+-]+)<\/span><\/td>\s*<td[^>]*><span[^>]*>([^<]+)<\/span><\/td>\s*<td[^>]*><span[^>]*>([^<]+)<\/span><\/td>/g;
    let fm;
    while ((fm = fRegex.exec(html)) !== null && futures.length < 15) {
      futures.push({ label: fm[1].trim(), last: fm[2].trim(), change: fm[3].trim(), change_pct: fm[4].trim() });
    }
    
    // ── EARNINGS ──
    const earnings = [];
    const earningsIdx = html.indexOf('Earnings Release');
    if (earningsIdx !== -1) {
      const eSection = html.substring(earningsIdx, earningsIdx + 20000);
      // Split by <tr to get rows
      const rows = eSection.split(/<tr\s/);
      for (const row of rows) {
        if (earnings.length >= 10) break;
        // Date: <a ...>Feb 17/a</a>
        const dateMatch = row.match(/>((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+[^<]*)<\/a>/);
        if (!dateMatch) continue;
        const date = dateMatch[1].trim();
        // Tickers: <a href="quote.ashx?t=PANW" class="tab-link">PANW</a>
        const tickers = [];
        const tickerRegex = /class="tab-link">([A-Z.]+)<\/a>/g;
        let tm;
        while ((tm = tickerRegex.exec(row)) !== null) {
          tickers.push(tm[1]);
        }
        if (tickers.length > 0) {
          earnings.push({ date, tickers });
        }
      }
    }
    
    // ── MAJOR NEWS ──
    // Pattern: <div class="hp_label-container..."><a...class="tab-link">NVDA</a> <span class="...fv-label...">+2.15%</span></div>
    const major_news = [];
    const newsIdx = html.indexOf('Major News');
    if (newsIdx !== -1) {
      const nSection = html.substring(newsIdx, newsIdx + 15000);
      const mnRegex = /class="tab-link">([A-Z.]{1,5})<\/a>\s*<span[^>]*>([+-][\d.]+%)<\/span>/g;
      let mn;
      while ((mn = mnRegex.exec(nSection)) !== null && major_news.length < 30) {
        major_news.push({ ticker: mn[1].trim(), change: mn[2].trim() });
      }
    }
    
    // ── MARKET STATS (Advancing/Declining, New High/Low, SMA50, SMA200) ──
    const market_stats = {};
    
    // Strip HTML tags to get plain text, then parse
    const plainText = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    
    // Debug: log area around "Advancing"
    const advIdx = plainText.indexOf('Advancing');
    if (advIdx !== -1) {
      console.log("Market stats raw:", plainText.substring(advIdx, advIdx + 300));
    } else {
      console.log("Market stats: 'Advancing' not found in plain text");
      // Try alternate search
      const sma50Idx = plainText.indexOf('SMA50');
      console.log("SMA50 found:", sma50Idx !== -1 ? plainText.substring(sma50Idx - 100, sma50Idx + 100) : "NOT FOUND");
    }
    
    // Pattern: "Advancing XX.X% (NNNN) Declining (NNNN) XX.X%"
    const advMatch = plainText.match(/Advancing\s+([\d.]+)%\s*\((\d[\d,]*)\)\s*Declining\s*\((\d[\d,]*)\)\s*([\d.]+)%/);
    if (advMatch) {
      market_stats.advancing = { pct: parseFloat(advMatch[1]), count: parseInt(advMatch[2].replace(/,/g, '')) };
      market_stats.declining = { pct: parseFloat(advMatch[4]), count: parseInt(advMatch[3].replace(/,/g, '')) };
    }
    // Pattern: "New High XX.X% (NNN) New Low (NNN) XX.X%"
    const nhMatch = plainText.match(/New High\s+([\d.]+)%\s*\((\d[\d,]*)\)\s*New Low\s*\((\d[\d,]*)\)\s*([\d.]+)%/);
    if (nhMatch) {
      market_stats.new_high = { pct: parseFloat(nhMatch[1]), count: parseInt(nhMatch[2].replace(/,/g, '')) };
      market_stats.new_low = { pct: parseFloat(nhMatch[4]), count: parseInt(nhMatch[3].replace(/,/g, '')) };
    }
    // Pattern: "Above XX.X% (NNNN) SMA50 Below (NNNN) XX.X%"  
    const sma50Match = plainText.match(/Above\s+([\d.]+)%\s*\((\d[\d,]*)\)\s*SMA50\s*Below\s*\((\d[\d,]*)\)\s*([\d.]+)%/);
    if (sma50Match) {
      market_stats.sma50_above = { pct: parseFloat(sma50Match[1]), count: parseInt(sma50Match[2].replace(/,/g, '')) };
      market_stats.sma50_below = { pct: parseFloat(sma50Match[4]), count: parseInt(sma50Match[3].replace(/,/g, '')) };
    }
    // Pattern: "Above XX.X% (NNNN) SMA200 Below (NNNN) XX.X%"
    const sma200Match = plainText.match(/Above\s+([\d.]+)%\s*\((\d[\d,]*)\)\s*SMA200\s*Below\s*\((\d[\d,]*)\)\s*([\d.]+)%/);
    if (sma200Match) {
      market_stats.sma200_above = { pct: parseFloat(sma200Match[1]), count: parseInt(sma200Match[2].replace(/,/g, '')) };
      market_stats.sma200_below = { pct: parseFloat(sma200Match[4]), count: parseInt(sma200Match[3].replace(/,/g, '')) };
    }
    
    console.log(`Homepage: ${futures.length} futures, ${earnings.length} earnings rows, ${major_news.length} major news, market_stats keys: ${Object.keys(market_stats).join(",") || "NONE"}`);
    return { futures, earnings, major_news, market_stats };
  } catch (err) {
    console.error("Homepage fetch error:", err.message);
    return { futures: [], earnings: [], major_news: [] };
  }
}

// ── FMP Live Quotes (replaces Finviz for theme universe) ──
const FMP_BASE = "https://financialmodelingprep.com/stable";

// Fetch EPS + Revenue from FMP's income-statement endpoint. Used for the
// chart panel bars (both quarterly and annual modes). FMP doesn't provide
// YoY% directly so we compute it from year-over-year pairs.
//   period: "quarter" (default) → 8 trailing quarters, key `${Qn}-${year}`
//   period: "annual"            → 9 trailing years,    key `${year}`
async function fetchFinancialsFmp(ticker, fmpKey, period = "quarter") {
  if (!fmpKey || !ticker) return [];
  try {
    const isAnnual = period === "annual";
    const limit = isAnnual ? 10 : 12;
    const take = isAnnual ? 9 : 8;
    const incomeUrl = `${FMP_BASE}/income-statement?symbol=${ticker}&period=${period}&limit=${limit}&apikey=${fmpKey}`;
    const cashUrl = `${FMP_BASE}/cash-flow-statement?symbol=${ticker}&period=${period}&limit=${limit}&apikey=${fmpKey}`;
    // Cash flow is a "nice to have" — if it 404s or rate-limits we still
    // want EPS/Revenue bars to render.
    const [incResp, cfResp] = await Promise.all([
      fetch(incomeUrl),
      fetch(cashUrl).catch(() => null),
    ]);
    if (!incResp.ok) return [];
    const data = await incResp.json();
    if (!Array.isArray(data) || data.length === 0) return [];
    const cfData = cfResp && cfResp.ok ? await cfResp.json().catch(() => []) : [];
    // Key cash-flow rows by filing date so we can join onto income rows.
    const cfByDate = new Map();
    if (Array.isArray(cfData)) {
      for (const cf of cfData) {
        if (cf && cf.date) cfByDate.set(cf.date, cf);
      }
    }
    // FMP returns newest-first. Reverse for oldest → newest bar rendering.
    const asc = data.slice().reverse();
    const keyFor = (q) => {
      const year = parseInt(q.fiscalYear || q.calendarYear || (q.date || "").slice(0, 4));
      if (!year) return null;
      return isAnnual ? String(year) : `${q.period}-${year}`;
    };
    const byKey = new Map();
    for (const q of asc) {
      const k = keyFor(q);
      if (k) byKey.set(k, q);
    }
    const out = [];
    for (const q of asc.slice(-take)) {
      const year = parseInt(q.fiscalYear || q.calendarYear || (q.date || "").slice(0, 4));
      if (!year) continue;
      const prevKey = isAnnual ? String(year - 1) : `${q.period}-${year - 1}`;
      const prev = byKey.get(prevKey);
      const revRaw = q.revenue != null ? q.revenue : null;
      const revenueM = revRaw != null ? revRaw / 1_000_000 : null;
      const eps = q.epsDiluted ?? q.eps ?? null;
      const prevEps = prev?.epsDiluted ?? prev?.eps ?? null;
      const prevRevM = prev?.revenue != null ? prev.revenue / 1_000_000 : null;
      // Cash flow per share — CANSLIM calls for cash-flow EPS ≥ 1.2× reported
      // EPS. Compute from operatingCashFlow / weightedAverageShsOutDil.
      const cf = cfByDate.get(q.date);
      const shares = q.weightedAverageShsOutDil || q.weightedAverageShsOut || null;
      const ocfPs =
        cf?.operatingCashFlow != null && shares && shares > 0
          ? cf.operatingCashFlow / shares
          : null;
      const fcfPs =
        cf?.freeCashFlow != null && shares && shares > 0
          ? cf.freeCashFlow / shares
          : null;
      const cfVsEpsPct =
        ocfPs != null && eps != null && eps > 0
          ? (ocfPs / eps - 1) * 100
          : null;
      const prevCf = prev ? cfByDate.get(prev.date) : null;
      const prevShares = prev?.weightedAverageShsOutDil || prev?.weightedAverageShsOut || null;
      const prevOcfPs =
        prevCf?.operatingCashFlow != null && prevShares && prevShares > 0
          ? prevCf.operatingCashFlow / prevShares
          : null;
      const ocfYoy =
        prevOcfPs != null && prevOcfPs !== 0 && ocfPs != null
          ? ((ocfPs - prevOcfPs) / Math.abs(prevOcfPs)) * 100
          : null;
      // Net margin — required for Minervini's Code 33 gate (3 consecutive
      // periods of accelerating margin expansion alongside EPS + Sales).
      const netMargin =
        q.netIncome != null && revRaw != null && revRaw > 0
          ? Math.round((q.netIncome / revRaw) * 1000) / 10
          : null;
      const revYoy =
        prevRevM != null && prevRevM > 0 && revenueM != null
          ? ((revenueM - prevRevM) / prevRevM) * 100
          : null;
      const epsYoy =
        prevEps != null && prevEps !== 0 && eps != null
          ? ((eps - prevEps) / Math.abs(prevEps)) * 100
          : null;
      const revenueYoyRounded = revYoy != null ? Math.round(revYoy * 10) / 10 : null;
      out.push({
        label: isAnnual ? String(year) : `${q.period}-${String(year).slice(2)}`,
        period: isAnnual ? "FY" : q.period,
        year,
        // report_date: actual SEC filing date (when earnings were reported)
        report_date: q.filingDate || q.date || null,
        revenue: revenueM,
        revenue_yoy: revenueYoyRounded,
        // Alias so the legacy chart marker code (expects sales_yoy) works too
        sales_yoy: revenueYoyRounded,
        revenue_fmt:
          revenueM != null
            ? revenueM >= 1000
              ? `${(revenueM / 1000).toFixed(1)}B`
              : `${Math.round(revenueM)}M`
            : null,
        eps,
        eps_yoy: epsYoy != null ? Math.round(epsYoy * 10) / 10 : null,
        net_margin: netMargin,
        ocf_ps: ocfPs != null ? Math.round(ocfPs * 100) / 100 : null,
        fcf_ps: fcfPs != null ? Math.round(fcfPs * 100) / 100 : null,
        ocf_yoy: ocfYoy != null ? Math.round(ocfYoy * 10) / 10 : null,
        cf_vs_eps_pct: cfVsEpsPct != null ? Math.round(cfVsEpsPct * 10) / 10 : null,
      });
    }
    return out;
  } catch (err) {
    console.error(`FMP ${period} fetch error for ${ticker}:`, err.message);
    return [];
  }
}

// ── Average Volume cache (24h TTL, persists across warm invocations) ──
// batch-quote never returns avgVolume — we backfill from /stable/profile
// and cache to avoid repeated calls on every 30s poll.
let avgVolCache = new Map(); // ticker -> { value: number, expiry: timestamp }

// ── Opening Range High cache (server-side, persists across warm invocations) ──
// Captures dayHigh from FMP batch-quote during 9:30–9:40 ET as the 5-min ORH
let orhCache = new Map();  // ticker -> { high, date }
let orhDate = null;        // YYYY-MM-DD, reset on new trading day

function isExtendedHours() {
  const now = new Date();
  const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  const et = new Date(etStr);
  const mins = et.getHours() * 60 + et.getMinutes();
  if (mins >= 240 && mins < 570) return "premarket";   // 4:00 AM - 9:29 AM ET
  if (mins >= 570 && mins < 960) return null;           // 9:30 AM - 3:59 PM ET (regular)
  return "aftermarket"; // 4:00 PM - 3:59 AM ET (post-market through overnight)
}

// ── Pre-Market Briefing: fetch index quotes + compute session bias ──
async function fetchBriefing(apiKey, pipelineBriefing) {
  const BRIEFING_SYMBOLS = ["SPY", "QQQ", "IWM", "DIA"];
  const VIX_SYMBOL = "VIX"; // FMP uses VIX (not ^VIX)
  const allSyms = [...BRIEFING_SYMBOLS, VIX_SYMBOL];

  if (!apiKey) return null;

  try {
    const url = `${FMP_BASE}/batch-quote?symbols=${allSyms.join(",")}&apikey=${apiKey}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!Array.isArray(data)) return null;

    const quoteMap = {};
    data.forEach(q => { if (q.symbol) quoteMap[q.symbol] = q; });

    // Build index cards
    const indices = {};
    for (const sym of BRIEFING_SYMBOLS) {
      const q = quoteMap[sym];
      if (!q) continue;
      const prevClose = q.previousClose || 0;
      const gapPct = prevClose > 0 ? Math.round((q.price - prevClose) / prevClose * 10000) / 100 : 0;
      indices[sym] = {
        price: q.price,
        prev_close: prevClose,
        open: q.open || null,
        gap_pct: gapPct,
        change_pct: q.changePercentage ?? gapPct,
        volume: q.volume || 0,
        avg_volume: q.avgVolume || 0,
      };
    }

    // VIX
    const vq = quoteMap[VIX_SYMBOL] || quoteMap["^VIX"];
    let vix = null;
    if (vq) {
      vix = {
        level: vq.price,
        prev: vq.previousClose || null,
        change: vq.previousClose ? Math.round((vq.price - vq.previousClose) * 100) / 100 : null,
        change_pct: vq.changePercentage ?? null,
      };
    }

    // Session bias heuristic (rules-based)
    const bias = computeSessionBias(indices, vix, pipelineBriefing);

    return {
      indices,
      vix,
      session_bias: bias,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error("Briefing fetch error:", err.message);
    return null;
  }
}

function computeSessionBias(indices, vix, pipeline) {
  // Score accumulator: positive = bullish, negative = bearish
  let score = 0;
  const factors = [];

  const spy = indices.SPY;
  if (!spy) return { bias: "NEUTRAL", strength: 0, factors: [] };

  // 1. SPY overnight gap direction (weight: 20)
  const gapPct = spy.gap_pct || 0;
  if (gapPct > 0.3) { score += 20; factors.push({ label: `SPY gap +${gapPct.toFixed(2)}%`, signal: "BULL", pts: 20 }); }
  else if (gapPct > 0.1) { score += 10; factors.push({ label: `SPY gap +${gapPct.toFixed(2)}%`, signal: "BULL", pts: 10 }); }
  else if (gapPct < -0.3) { score -= 20; factors.push({ label: `SPY gap ${gapPct.toFixed(2)}%`, signal: "BEAR", pts: -20 }); }
  else if (gapPct < -0.1) { score -= 10; factors.push({ label: `SPY gap ${gapPct.toFixed(2)}%`, signal: "BEAR", pts: -10 }); }
  else { factors.push({ label: `SPY gap flat ${gapPct.toFixed(2)}%`, signal: "NEUTRAL", pts: 0 }); }

  // 2. VIX direction (weight: 15)
  if (vix && vix.change != null) {
    const vixChg = vix.change;
    const vixPctChg = vix.prev > 0 ? (vixChg / vix.prev) * 100 : 0;
    if (vixPctChg > 5) { score -= 15; factors.push({ label: `VIX up ${vixPctChg.toFixed(1)}%`, signal: "BEAR", pts: -15 }); }
    else if (vixPctChg > 2) { score -= 8; factors.push({ label: `VIX up ${vixPctChg.toFixed(1)}%`, signal: "BEAR", pts: -8 }); }
    else if (vixPctChg < -3) { score += 15; factors.push({ label: `VIX down ${vixPctChg.toFixed(1)}%`, signal: "BULL", pts: 15 }); }
    else if (vixPctChg < -1) { score += 8; factors.push({ label: `VIX down ${vixPctChg.toFixed(1)}%`, signal: "BULL", pts: 8 }); }
    else { factors.push({ label: `VIX flat`, signal: "NEUTRAL", pts: 0 }); }

    // VIX regime penalty
    if (vix.level >= 30) { score -= 10; factors.push({ label: `VIX HIGH (${vix.level})`, signal: "BEAR", pts: -10 }); }
  }

  // 3. Previous day IBS from pipeline (weight: 20)
  if (pipeline?.indices?.SPY?.ibs != null) {
    const ibs = pipeline.indices.SPY.ibs;
    if (ibs > 0.7) { score += 20; factors.push({ label: `Prev IBS ${ibs.toFixed(2)} (strong close)`, signal: "BULL", pts: 20 }); }
    else if (ibs > 0.5) { score += 8; factors.push({ label: `Prev IBS ${ibs.toFixed(2)}`, signal: "BULL", pts: 8 }); }
    else if (ibs < 0.3) { score -= 20; factors.push({ label: `Prev IBS ${ibs.toFixed(2)} (weak close)`, signal: "BEAR", pts: -20 }); }
    else if (ibs < 0.5) { score -= 8; factors.push({ label: `Prev IBS ${ibs.toFixed(2)}`, signal: "BEAR", pts: -8 }); }
  }

  // 4. QQQ/IWM alignment with SPY (weight: 15)
  const qqq = indices.QQQ;
  const iwm = indices.IWM;
  if (qqq && iwm) {
    const spyDir = Math.sign(spy.gap_pct || 0);
    const qqqDir = Math.sign(qqq.gap_pct || 0);
    const iwmDir = Math.sign(iwm.gap_pct || 0);
    if (spyDir !== 0 && spyDir === qqqDir && spyDir === iwmDir) {
      const pts = spyDir > 0 ? 15 : -15;
      score += pts;
      factors.push({ label: "Indices aligned " + (spyDir > 0 ? "up" : "down"), signal: spyDir > 0 ? "BULL" : "BEAR", pts });
    } else if (spyDir !== 0) {
      factors.push({ label: "Indices diverging", signal: "NEUTRAL", pts: 0 });
    }
  }

  // 5. Previous day breadth from pipeline (weight: 15)
  if (pipeline?.breadth?.prev_up_pct != null) {
    const upPct = pipeline.breadth.prev_up_pct;
    if (upPct > 60) { score += 15; factors.push({ label: `Prev breadth ${upPct}% up`, signal: "BULL", pts: 15 }); }
    else if (upPct > 55) { score += 5; factors.push({ label: `Prev breadth ${upPct}% up`, signal: "BULL", pts: 5 }); }
    else if (upPct < 40) { score -= 15; factors.push({ label: `Prev breadth ${upPct}% up`, signal: "BEAR", pts: -15 }); }
    else if (upPct < 45) { score -= 5; factors.push({ label: `Prev breadth ${upPct}% up`, signal: "BEAR", pts: -5 }); }
    else { factors.push({ label: `Prev breadth ${upPct}% (mixed)`, signal: "NEUTRAL", pts: 0 }); }
  }

  // Determine bias — hide direction below threshold (inspired by the Reddit post)
  const strength = Math.min(Math.abs(score), 100);
  let bias = "NEUTRAL";
  if (strength >= 25) {
    bias = score > 0 ? "BULL" : "BEAR";
  }

  return { bias, strength, score, factors };
}

async function fetchFmpUniverse(tickers, apiKey) {
  if (!tickers || tickers.length === 0 || !apiKey) return { universe: [], rawQuotes: [] };
  const BATCH = 500; // FMP Premium supports large batches
  const CONCURRENCY = 3; // parallel requests
  const universe = [];
  const rawQuotes = []; // keep full FMP data for burst scanner
  const batches = [];

  for (let i = 0; i < tickers.length; i += BATCH) {
    batches.push(tickers.slice(i, i + BATCH));
  }

  // Fetch batches in parallel groups
  for (let g = 0; g < batches.length; g += CONCURRENCY) {
    const group = batches.slice(g, g + CONCURRENCY);
    const promises = group.map(async (batch) => {
      const symbolStr = batch.join(",");
      try {
        const url = `${FMP_BASE}/batch-quote?symbols=${symbolStr}&apikey=${apiKey}`;
        const resp = await fetch(url);
        if (!resp.ok) {
          console.error(`FMP universe batch failed: ${resp.status}`);
          return [];
        }
        const data = await resp.json();
        if (!Array.isArray(data)) return [];
        return data.filter(q => q.symbol);
      } catch (err) {
        console.error(`FMP universe batch error: ${err.message}`);
        return [];
      }
    });
    const groupResults = await Promise.all(promises);
    groupResults.forEach(batch => {
      batch.forEach(q => {
        rawQuotes.push(q);
        universe.push({
          ticker: q.symbol,
          price: q.price ?? null,
          change: q.changePercentage ?? null,
          volume: q.volume ?? null,
          avgVolume: q.avgVolume ?? null,
          open: q.open ?? null,
          high: q.dayHigh ?? null,
          low: q.dayLow ?? null,
          dayHigh: q.dayHigh ?? null,
          dayLow: q.dayLow ?? null,
          previousClose: q.previousClose ?? null,
          // 52-week range — consumed by live H/L breadth computation
          yearHigh: q.yearHigh ?? null,
          yearLow: q.yearLow ?? null,
        });
      });
    });
    if (g + CONCURRENCY < batches.length) await new Promise(r => setTimeout(r, 100));
  }

  console.log(`FMP universe: ${universe.length}/${tickers.length} quotes fetched`);

  // ── Update ORH cache: capture dayHigh during 9:30–9:40 ET window ──
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const etDate = et.toISOString().slice(0, 10);
  const etMinutes = et.getHours() * 60 + et.getMinutes(); // minutes since midnight ET
  const marketOpen = 9 * 60 + 30;  // 9:30 = 570
  const orhWindow = 9 * 60 + 40;   // 9:40 = 580

  // Reset cache on new trading day
  if (orhDate !== etDate) {
    orhCache = new Map();
    orhDate = etDate;
  }

  // During 9:30–9:40 ET, update ORH with max of current dayHigh
  if (etMinutes >= marketOpen && etMinutes <= orhWindow) {
    universe.forEach(u => {
      if (u.high != null) {
        const prev = orhCache.get(u.ticker);
        if (!prev || u.high > prev) orhCache.set(u.ticker, u.high);
      }
    });
    console.log(`ORH cache updated: ${orhCache.size} tickers (${etMinutes - marketOpen}min into session)`);
  }

  // Attach ORH to each universe entry (fall back to open price if no cached ORH)
  universe.forEach(u => {
    u.orh = orhCache.get(u.ticker) ?? u.open ?? null;
  });

  return { universe, rawQuotes };
}

// ── Yahoo Finance Extended Hours (v7 batch quote with crumb) ──
let yahooCrumb = null;
let yahooCookies = null;
let yahooCrumbExpiry = 0;

async function getYahooCrumb() {
  if (yahooCrumb && yahooCookies && Date.now() < yahooCrumbExpiry) {
    return { crumb: yahooCrumb, cookies: yahooCookies };
  }
  // Step 1: Get cookies from fc.yahoo.com
  const initResp = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
    redirect: "manual",
  });
  const setCookies = initResp.headers.getSetCookie?.() || [];
  const cookieStr = setCookies.map(c => c.split(";")[0]).join("; ");

  // Step 2: Get crumb
  const crumbResp = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Cookie: cookieStr,
    },
  });
  if (!crumbResp.ok) throw new Error(`Yahoo crumb failed: ${crumbResp.status}`);
  const crumb = await crumbResp.text();

  yahooCrumb = crumb;
  yahooCookies = cookieStr;
  yahooCrumbExpiry = Date.now() + 10 * 60 * 1000; // 10 min cache
  console.log(`Yahoo crumb refreshed (${crumb.length} chars)`);
  return { crumb, cookies: cookieStr };
}

async function fetchYahooExtHours(tickers, session) {
  const BATCH = 200; // safe URL length for ~200 tickers
  const results = new Map();
  const { crumb, cookies } = await getYahooCrumb();

  const pmFields = "symbol,preMarketPrice,preMarketChangePercent";
  const ahFields = "symbol,postMarketPrice,postMarketChangePercent";
  const fields = session === "premarket" ? pmFields : ahFields;

  for (let i = 0; i < tickers.length; i += BATCH) {
    const batch = tickers.slice(i, i + BATCH).join(",");
    try {
      const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${batch}&crumb=${encodeURIComponent(crumb)}&fields=${fields}`;
      const resp = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          Cookie: cookies,
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) { console.error(`Yahoo v7 batch ${resp.status}`); continue; }
      const data = await resp.json();
      const quotes = data?.quoteResponse?.result || [];
      for (const q of quotes) {
        const price = session === "premarket" ? q.preMarketPrice : q.postMarketPrice;
        const changePct = session === "premarket" ? q.preMarketChangePercent : q.postMarketChangePercent;
        if (price != null && changePct != null) {
          results.set(q.symbol, {
            extPrice: Math.round(price * 100) / 100,
            extChange: Math.round(changePct * 100) / 100,
          });
        }
      }
    } catch (e) { console.error(`Yahoo ext hours batch error: ${e.message}`); }
  }

  console.log(`Yahoo ext hours (${session}): ${results.size}/${tickers.length} tickers with data`);
  return results;
}

// ── Live Momentum Burst Scanner (Stockbee/Pradeep Bonde criteria) ──
// Uses FMP real-time quote data — no extra API calls needed.
// $ BREAKOUT: C-O >= $0.90, V > 100K, change > 2%
// 4% BREAKOUT: C/prevClose >= 1.04, V > 100K, C >= $3, closing in upper 70% of range
function scanMomentumBursts(rawQuotes) {
  const results = [];
  for (const q of rawQuotes) {
    const C = q.price;
    const O = q.open;
    const H = q.dayHigh;
    const L = q.dayLow;
    const V = q.volume;
    const C1 = q.previousClose;
    const avgV = q.avgVolume;

    // Skip bad/missing data
    if (!C || !O || !H || !L || !V || !C1 || C1 === 0 || (H - L) === 0) continue;
    // Skip penny stocks
    if (C < 3) continue;
    // Skip low volume
    if (V < 100000) continue;

    const scanTypes = [];
    const dollarBody = C - O;
    const changePct = ((C / C1) - 1) * 100;
    const closeRange = (C - L) / (H - L);
    const volRatio = avgV > 0 ? V / avgV : 0;

    // $ BREAKOUT: big dollar body move with volume
    if (dollarBody >= 0.90 && changePct > 2) {
      scanTypes.push("$");
    }

    // 4% BREAKOUT: 4%+ gain, closing in upper range, volume surge
    if (C / C1 >= 1.04 && closeRange >= 0.70) {
      scanTypes.push("4%");
    }

    if (scanTypes.length === 0) continue;

    results.push({
      ticker: q.symbol,
      scan: scanTypes,
      close: Math.round(C * 100) / 100,
      open: Math.round(O * 100) / 100,
      high: Math.round(H * 100) / 100,
      low: Math.round(L * 100) / 100,
      volume: V,
      change_pct: Math.round(changePct * 100) / 100,
      dollar_move: Math.round(dollarBody * 100) / 100,
      close_range: Math.round(closeRange * 1000) / 10,
      vol_ratio: Math.round(volRatio * 100) / 100,
    });
  }

  // Sort by change% descending
  results.sort((a, b) => b.change_pct - a.change_pct);
  console.log(`Live momentum burst: ${results.length} signals from ${rawQuotes.length} quotes`);
  return results;
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
    // ETF holdings — short-circuit before Finviz login
    const etfTicker = (req.query.etf || "").trim().toUpperCase();
    if (etfTicker) {
      const fmpKey = process.env.FMP_API_KEY;
      if (!fmpKey) return res.status(200).json({ holdings: [] });
      try {
        const r = await fetch(`https://financialmodelingprep.com/api/v3/etf-holder/${encodeURIComponent(etfTicker)}?apikey=${fmpKey}`);
        const raw = r.ok ? await r.json() : [];
        if (req.query.debug) return res.status(200).json({ status: r.status, raw: JSON.stringify(raw).slice(0, 2000) });
        const arr = Array.isArray(raw) ? raw : (raw?.holdings || []);
        const holdings = arr
          .filter(h => h.asset && h.weightPercentage != null)
          .sort((a, b) => b.weightPercentage - a.weightPercentage)
          .slice(0, 15)
          .map(h => ({ ticker: h.asset, name: h.name || h.asset, weight: Math.round(h.weightPercentage * 10) / 10 }));
        return res.status(200).json({ holdings });
      } catch (e) {
        return res.status(200).json({ holdings: [], error: e.message });
      }
    }

    const cookies = await loginFinviz();

    // Parse all ticker params — both go into a single FMP batch
    const tickerParam = req.query.tickers || "";
    const watchlistTickers = tickerParam
      ? tickerParam
          .split(",")
          .map((t) => t.trim().toUpperCase())
          .filter(Boolean)
      : [];

    const universeParam = req.query.universe || "";
    const universeTickers = universeParam
      ? universeParam
          .split(",")
          .map((t) => t.trim().toUpperCase())
          .filter(Boolean)
      : [];

    // ── Single FMP batch for ALL tickers (watchlist + universe) ──
    const extSession = isExtendedHours();
    const fmpKey = process.env.FMP_API_KEY;
    let watchlist = [];
    let themeUniverse = [];
    let rawQuotes = [];

    // Deduplicate all tickers into one set
    const allTickers = [...new Set([...watchlistTickers, ...universeTickers])];
    const watchlistSet = new Set(watchlistTickers);
    const universeSet = new Set(universeTickers);

    if (allTickers.length > 0 && fmpKey) {
      // One FMP call for everything
      const fmpResult = await fetchFmpUniverse(allTickers, fmpKey);
      rawQuotes = fmpResult.rawQuotes;

      // Split results back into watchlist vs universe
      const quoteMap = {};
      fmpResult.rawQuotes.forEach(q => { quoteMap[q.symbol] = q; });

      // Build watchlist response from FMP data
      watchlistTickers.forEach(tk => {
        const q = quoteMap[tk];
        if (q) {
          watchlist.push({
            ticker: q.symbol,
            company: q.name || q.symbol,
            price: q.price ?? null,
            change: q.changePercentage ?? null,
            gap: q.previousClose && q.open
              ? Math.round(((q.open - q.previousClose) / q.previousClose) * 10000) / 100
              : null,
            volume: q.volume ?? null,
            avgVolume: q.avgVolume ?? null,
            open: q.open ?? null,
            dayHigh: q.dayHigh ?? null,
            dayLow: q.dayLow ?? null,
            previousClose: q.previousClose ?? null,
            market_cap: q.marketCap != null ? String(q.marketCap) : null,
          });
        }
      });

      // ── Backfill avgVolume from /stable/profile ──
      // batch-quote never returns avgVolume. Fetch from profile for entries
      // missing it (watchlist + universe). Cached 24h so 30s polls don't
      // re-fetch. Capped at 100 profile calls per request — well under FMP's
      // 700/min limit, lets the value-chain drawers (~80 tickers each) fully
      // populate avgVolume on the first poll instead of trickling over
      // multiple cycles.
      const allEntries = [...watchlist, ...fmpResult.universe];
      const needAvgVol = allEntries.filter(e => {
        if (e.avgVolume != null) return false;
        const cached = avgVolCache.get(e.ticker);
        if (cached && cached.expiry > Date.now()) {
          e.avgVolume = cached.value;
          return false;
        }
        return true;
      }).slice(0, 100);
      if (needAvgVol.length > 0) {
        await Promise.allSettled(
          needAvgVol.map(async (e) => {
            try {
              const r = await fetch(
                `${FMP_BASE}/profile?symbol=${e.ticker}&apikey=${fmpKey}`,
                { signal: AbortSignal.timeout(5000) }
              );
              if (r.ok) {
                const d = await r.json();
                const av = (d && d[0] && d[0].averageVolume) || null;
                e.avgVolume = av;
                avgVolCache.set(e.ticker, { value: av, expiry: Date.now() + 86400000 });
              }
            } catch { /* ignore */ }
          })
        );
        console.log(`avgVolume backfill: ${needAvgVol.filter(e => e.avgVolume != null).length}/${needAvgVol.length}`);
      }

      // Universe: filter to universe tickers only
      // During extended hours, fetch actual trade prices from Yahoo Finance
      if (extSession && universeTickers.length > 0) {
        const yahooExt = await fetchYahooExtHours(universeTickers, extSession);

        themeUniverse = fmpResult.universe
          .filter(u => universeSet.has(u.ticker))
          .map(u => {
            const ext = yahooExt.get(u.ticker);
            return {
              ...u,
              price: ext ? ext.extPrice : u.price,
              ext_change: ext ? ext.extChange : null,
              ext_volume: null,
            };
          });
      } else {
        themeUniverse = fmpResult.universe.filter(u => universeSet.has(u.ticker));
      }
    } else if (allTickers.length > 0) {
      // Fallback to Finviz if no FMP key
      if (watchlistTickers.length > 0) {
        watchlist = await fetchWatchlistFinviz(cookies, watchlistTickers);
      }
      if (universeTickers.length > 0) {
        themeUniverse = await fetchThemeUniverse(cookies, universeTickers);
      }
    }

    // Live momentum burst scan (uses FMP data already fetched — no extra API calls)
    // Skip during extended hours — AH prices mix with regular OHLC causing false signals
    const momentumBurst = rawQuotes.length > 0 && !extSession ? scanMomentumBursts(rawQuotes) : [];

    // Fetch news and peers for a single ticker if requested
    const newsTicker = (req.query.news || "").trim().toUpperCase();
    const tickerData = newsTicker ? await fetchTickerNews(cookies, newsTicker) : null;

    // FMP bar data + FMP peer comparison — run in parallel
    let quartersFallback = [];
    let annualFallback = [];
    let fmpPeers = [];
    let fmpEarningsDate = null;
    if (newsTicker && fmpKey) {
      const needQuarters = !tickerData?.quarters || tickerData.quarters.length === 0;
      const today = new Date();
      const from = today.toISOString().slice(0, 10);
      const to = new Date(today.getTime() + 120 * 86400000).toISOString().slice(0, 10);
      const [qData, aData, peersResp, erResp] = await Promise.all([
        needQuarters ? fetchFinancialsFmp(newsTicker, fmpKey, "quarter") : Promise.resolve([]),
        fetchFinancialsFmp(newsTicker, fmpKey, "annual"),
        fetch(`${FMP_BASE}/stock-peers?symbol=${encodeURIComponent(newsTicker)}&apikey=${fmpKey}`)
          .then(r => r.json())
          .catch(() => null),
        fetch(`${FMP_BASE}/earnings-calendar?symbol=${encodeURIComponent(newsTicker)}&from=${from}&to=${to}&apikey=${fmpKey}`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null),
      ]);
      quartersFallback = qData;
      annualFallback = aData;
      // FMP /stable/stock-peers returns [{symbol, companyName, price, mktCap, ...}]
      if (Array.isArray(peersResp) && peersResp.length > 0 && peersResp[0]?.symbol) {
        fmpPeers = peersResp.map(p => p.symbol).filter(p => p && p !== newsTicker);
      }
      // FMP earnings calendar — pick the soonest upcoming date
      // Defensive: filter to date >= today (FMP sometimes returns historical
      // entries within the window) and require ticker symbol match.
      if (Array.isArray(erResp) && erResp.length > 0) {
        const sorted = erResp
          .filter(e => e.date && e.date >= from && (!e.symbol || e.symbol.toUpperCase() === newsTicker))
          .sort((a, b) => a.date.localeCompare(b.date));
        if (sorted[0]) {
          fmpEarningsDate = { date: sorted[0].date, time: sorted[0].time || null };
        }
      }
    }

    // Fetch homepage data (futures, earnings, major news) if requested
    const wantHomepage = req.query.homepage === "1";
    const homepage = wantHomepage ? await fetchHomepage(cookies) : null;

    // Pre-market briefing (index quotes + session bias)
    const wantBriefing = req.query.briefing === "1";
    let briefing = null;
    if (wantBriefing && fmpKey) {
      // Parse pipeline briefing data passed as JSON query param
      let pipelineBriefing = null;
      try {
        if (req.query.pb) pipelineBriefing = JSON.parse(decodeURIComponent(req.query.pb));
      } catch {}
      briefing = await fetchBriefing(fmpKey, pipelineBriefing);
    }

    return res.status(200).json({
      ok: true,
      timestamp: new Date().toISOString(),
      extended_hours: extSession || false,
      watchlist,
      theme_universe: themeUniverse,
      news: tickerData?.news || null,
      peers: tickerData?.peers || null,
      fmpPeers: fmpPeers.length > 0 ? fmpPeers : null,
      description: tickerData?.description || null,
      earningsData: tickerData?.earningsData || null,
      earningsDate: fmpEarningsDate || null,
      finvizQuarters:
        tickerData?.quarters && tickerData.quarters.length > 0
          ? tickerData.quarters
          : quartersFallback.length > 0
          ? quartersFallback
          : null,
      finvizAnnual: annualFallback.length > 0 ? annualFallback : null,
      analyst: tickerData?.analyst || null,
      homepage,
      momentum_burst: momentumBurst,
      briefing,
    });
  } catch (err) {
    console.error("Live API error:", err);
    return res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
}