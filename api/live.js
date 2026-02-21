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
      
      // Log missing tickers
      const returned = new Set(parsed.map(p => p.ticker));
      const missing = batch.filter(t => !returned.has(t));
      if (missing.length > 0) {
        console.log(`Watchlist batch: ${missing.length} tickers missing from response: ${missing.join(",")}`);
      }
      
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

  console.log(`Watchlist: ${results.length}/${tickers.length} tickers fetched, ${results.filter(r => r.change != null).length} with change data`);
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
        const headline = linkMatch[2].trim();
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
    const rawTarget = epsGet('Target Price');
    if (rawTarget) analyst.target_price = rawTarget;
    const rawRecom = epsGet('Recom');
    if (rawRecom) analyst.recommendation = parseFloat(rawRecom);
    
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
    return { news, peers, description, earningsData, quarters, analyst };
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

// ── Live Episodic Pivot Scanner ──
// Refined EP criteria per Qullamaggie methodology:
//   - Volume ≥4x avg (400% RVol) — serious institutional interest
//   - Gap ≥4% AND change ≥8%, OR power move change ≥10%
//   - Mid-cap+ ($500M-$200B ideal)
//   - Near earnings = strongest catalyst (flagged)
//   - Checks: not already extended (ATR to 50MA), resistance clearance
async function fetchEpisodicPivots(cookies) {
  const results = [];
  
  // Pass 1: Gap-and-go — gap up ≥4%, mid-cap+
  const gapUrl = `${FINVIZ_EXPORT_URL}?v=152&f=cap_midover,ta_gap_u4&o=-gap`;
  
  // Pass 2: Power moves — top gainers ≥8% change
  const powerUrl = `${FINVIZ_EXPORT_URL}?v=152&f=cap_midover,ta_changeup_u8&o=-change`;
  
  const seen = new Set();
  
  for (const [label, url] of [["gap", gapUrl], ["power", powerUrl]]) {
    try {
      const resp = await fetch(url, { headers: { ...HEADERS, Cookie: cookies } });
      if (!resp.ok) continue;
      const ct = resp.headers.get("content-type") || "";
      if (ct.includes("html")) continue;
      
      const text = await resp.text();
      const rows = parseCSV(text);
      
      for (const raw of rows) {
        const r = normalizeRow(raw);
        const ticker = r["Ticker"];
        if (!ticker || seen.has(ticker)) continue;
        seen.add(ticker);
        
        const price = num(r["Price"]);
        const change = pct(r["Change"]);
        const gap = pct(r["Gap"]);
        const relVol = num(r["Rel Volume"]);
        const volume = r["Volume"];
        const avgVol = r["Avg Volume"];
        const high52w = pct(r["52W High"]);  // % off 52W high (negative = below)
        const rsi = num(r["RSI"]);
        const atr = num(r["ATR"]);
        const earnings = r["Earnings Date"] || r["Earnings"] || "";
        
        // Core EP criteria
        const isGapAndGo = gap >= 4 && change >= 8;
        const isPowerMove = change >= 10;
        const meetsVol = relVol >= 4.0;  // 400% RVol per Qullamaggie
        
        if (!(isGapAndGo || isPowerMove) || !meetsVol) continue;
        
        // Quality scoring (0-100)
        let quality = 50;  // base
        
        // Volume strength: 4x=base, 8x+=excellent
        if (relVol >= 8) quality += 15;
        else if (relVol >= 6) quality += 10;
        else if (relVol >= 4) quality += 5;
        
        // Gap + change magnitude
        if (gap >= 15) quality += 10;
        else if (gap >= 10) quality += 7;
        else if (gap >= 6) quality += 3;
        
        // Resistance clearance: near or above 52W high = broke through supply
        if (high52w !== null && high52w >= -5) quality += 15;  // within 5% of 52W high
        else if (high52w !== null && high52w >= -15) quality += 5;
        
        // Earnings proximity = strongest catalyst
        let nearEarnings = false;
        if (earnings) {
          // Check if earnings is within ±3 days
          try {
            const parts = earnings.replace(/[ab]$/i, '').trim().split(/\s+/);
            if (parts.length >= 2) {
              const y = new Date().getFullYear();
              const ed = new Date(`${parts[0]} ${parts[1]} ${y}`);
              const daysDiff = Math.abs(Math.round((ed - new Date()) / 86400000));
              if (daysDiff <= 3) { nearEarnings = true; quality += 10; }
            }
          } catch(e) {}
        }
        
        // Penalty: very high RSI (>85) = already extended, may be chasing
        if (rsi > 85) quality -= 10;
        
        quality = Math.min(100, Math.max(0, quality));
        
        results.push({
          ticker,
          company: r["Company"],
          sector: r["Sector"],
          industry: r["Industry"],
          date: new Date().toISOString().split("T")[0],
          days_ago: 0,
          ep_type: isGapAndGo ? "gap" : "power",
          gap_pct: Math.round(gap * 10) / 10,
          change_pct: Math.round(change * 10) / 10,
          vol_ratio: Math.round(relVol * 10) / 10,
          close_range: 0,
          close: price,
          volume,
          avg_vol: avgVol,
          market_cap: r["Market Cap"],
          rsi,
          high_52w: high52w,
          atr,
          near_earnings: nearEarnings,
          quality,
          consol: { status: "fresh", days_since: 0, pullback_pct: 0, vol_contraction: 0, held_gap: true },
        });
      }
    } catch (err) {
      console.error(`EP scan ${label} error:`, err.message);
    }
  }
  
  // Sort: quality desc, then gap desc
  results.sort((a, b) => b.quality - a.quality || b.gap_pct - a.gap_pct);
  console.log(`EP scan: ${results.length} live pivots found`);
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

    // Fetch news and peers for a single ticker if requested
    const newsTicker = (req.query.news || "").trim().toUpperCase();
    const tickerData = newsTicker ? await fetchTickerNews(cookies, newsTicker) : null;

    // Fetch homepage data (futures, earnings, major news) if requested
    const wantHomepage = req.query.homepage === "1";
    const homepage = wantHomepage ? await fetchHomepage(cookies) : null;

    // Fetch live episodic pivots if requested
    const wantEP = req.query.ep === "scan";
    const epSignals = wantEP ? await fetchEpisodicPivots(cookies) : null;

    return res.status(200).json({
      ok: true,
      timestamp: new Date().toISOString(),
      watchlist,
      theme_universe: themeUniverse,
      news: tickerData?.news || null,
      peers: tickerData?.peers || null,
      description: tickerData?.description || null,
      earningsData: tickerData?.earningsData || null,
      finvizQuarters: tickerData?.quarters || null,
      analyst: tickerData?.analyst || null,
      homepage,
      ep_signals: epSignals,
    });
  } catch (err) {
    console.error("Live API error:", err);
    return res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
}
