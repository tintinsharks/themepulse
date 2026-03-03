// api/headlines.js — Vercel Serverless Function
// Scrapes TheStockCatalyst.com on demand for live headlines + mover data
// Usage: GET /api/headlines?tickers=NVDA,TSLA

const BASE_URL = "https://www.thestockcatalyst.com";
const PAGES = [
  { path: "/NYSEPMMovers", source: "pm" },
  { path: "/NYSEAHMovers", source: "ah" },
  { path: "/NasdaqPMEarningsMovers", source: "pm_er" },
  { path: "/NasdaqAHEarningsMovers", source: "ah_er" },
];

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// In-memory page cache (5 min TTL)
const pageCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCached(key) {
  const entry = pageCache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  return null;
}

function setCache(key, data) {
  pageCache.set(key, { data, ts: Date.now() });
}

// Parse change_pct from strings like "+5.2%", "-9.69 (-11.34%)", etc.
function parseChangePct(text) {
  if (!text) return null;
  // Format: "-9.69 (-11.34%)" — extract parenthetical
  const parenMatch = text.match(/\(([+-]?\d+\.?\d*)%?\)/);
  if (parenMatch) return parseFloat(parenMatch[1]);
  // Format: "+5.2%" or "-3.1%"
  const simpleMatch = text.match(/([+-]?\d+\.?\d*)%/);
  if (simpleMatch) return parseFloat(simpleMatch[1]);
  // Bare number
  const bare = parseFloat(text);
  return isNaN(bare) ? null : bare;
}

function parsePrice(text) {
  if (!text) return null;
  const cleaned = text.replace(/[$,]/g, "").trim();
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : Math.round(val * 100) / 100;
}

function parseVolume(text) {
  if (!text) return null;
  const t = text.trim().toUpperCase();
  const m = t.match(/([\d.]+)\s*([MKB])?/);
  if (!m) return null;
  let val = parseFloat(m[1]);
  if (m[2] === "M") val *= 1_000_000;
  else if (m[2] === "K") val *= 1_000;
  else if (m[2] === "B") val *= 1_000_000_000;
  else {
    // Plain number with commas
    val = parseFloat(text.replace(/,/g, ""));
  }
  return isNaN(val) ? null : Math.round(val);
}

function parseTicker(text) {
  if (!text) return null;
  let t = text.trim().toUpperCase();
  t = t.replace(/\s*\(.*?\)/, ""); // remove parenthetical
  t = t.replace(/[^A-Z.]/g, "");   // keep only letters and dots
  return t.length > 0 && t.length <= 6 ? t : null;
}

// Extract headlines from a cell's text content
function parseHeadlines(text) {
  if (!text) return [];
  const lines = text.split(/\n/).map(l => l.trim()).filter(l => l.length > 15);
  // Deduplicate and limit
  const seen = new Set();
  const result = [];
  for (const line of lines) {
    const clean = line.replace(/^[•\-·►▸]\s*/, "").trim();
    if (clean.length > 15 && !seen.has(clean)) {
      seen.add(clean);
      result.push(clean);
    }
    if (result.length >= 5) break;
  }
  return result;
}

// Parse HTML table rows using regex (zero-dep, no cheerio)
function parsePageHTML(html, source) {
  const results = {};

  // Find all table rows — match <tr>...</tr> blocks
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  let rowIndex = 0;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    rowIndex++;
    if (rowIndex <= 1) continue; // skip header row

    const rowHtml = rowMatch[1];
    // Extract cells — <td> or <th>
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells = [];
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      // Strip HTML tags to get text content
      const text = cellMatch[1].replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&#\d+;/g, "").replace(/\s+/g, " ").trim();
      cells.push(text);
    }

    if (cells.length < 4) continue;

    // Columns: [0]=Change, [1]=Last/Price, [2]=Symbol, [3]=Name, [4]=Volume, [5]=Headlines
    const ticker = parseTicker(cells[2]);
    if (!ticker) continue;

    const change_pct = parseChangePct(cells[0]);
    const price = parsePrice(cells[1]);
    const volume = parseVolume(cells[4] || "");
    const headlines = parseHeadlines(cells[5] || "");

    const company = (cells[3] || "").trim() || null;

    if (results[ticker]) {
      // Merge headlines from multiple pages
      const existing = results[ticker];
      const allHeadlines = [...new Set([...existing.headlines, ...headlines])].slice(0, 5);
      existing.headlines = allHeadlines;
      if (!existing.sources.includes(source)) existing.sources.push(source);
      // Prefer non-null values
      if (change_pct != null && existing.change_pct == null) existing.change_pct = change_pct;
      if (price != null && existing.price == null) existing.price = price;
      if (volume != null && existing.volume == null) existing.volume = volume;
      if (company && !existing.company) existing.company = company;
    } else {
      results[ticker] = {
        ticker,
        company,
        change_pct,
        price,
        volume,
        headlines,
        sources: [source],
      };
    }
  }

  return results;
}

async function fetchPage(page) {
  const cacheKey = page.path;
  const cached = getCached(cacheKey);
  if (cached) return { source: page.source, results: cached };

  const resp = await fetch(BASE_URL + page.path, {
    headers: { "User-Agent": UA },
  });
  if (!resp.ok) {
    console.log(`headlines: ${page.path} returned ${resp.status}`);
    return { source: page.source, results: {} };
  }
  const html = await resp.text();
  const results = parsePageHTML(html, page.source);

  setCache(cacheKey, results);
  return { source: page.source, results };
}

// Merge per-page results into a combined ticker map
function mergePageResults(pageResults) {
  const allData = {};
  for (const { results } of pageResults) {
    for (const [ticker, data] of Object.entries(results)) {
      if (allData[ticker]) {
        const existing = allData[ticker];
        existing.headlines = [...new Set([...existing.headlines, ...data.headlines])].slice(0, 5);
        for (const s of data.sources) {
          if (!existing.sources.includes(s)) existing.sources.push(s);
        }
        if (data.change_pct != null && existing.change_pct == null) existing.change_pct = data.change_pct;
        if (data.price != null && existing.price == null) existing.price = data.price;
        if (data.volume != null && existing.volume == null) existing.volume = data.volume;
      } else {
        allData[ticker] = { ...data };
      }
    }
  }
  return allData;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { tickers, mode } = req.query;

  // mode=all: return all movers from all 4 pages, categorized
  if (mode === "all") {
    try {
      const pageResults = await Promise.all(PAGES.map(fetchPage));
      const allData = mergePageResults(pageResults);

      // Categorize: earnings (from pm_er/ah_er pages) vs SIP movers (pm/ah pages)
      const earnings_movers = [];
      const pm_movers = [];
      const ah_movers = [];
      const headlines = {};

      for (const [ticker, d] of Object.entries(allData)) {
        const entry = { ticker, company: d.company || ticker, price: d.price, change_pct: d.change_pct, volume: d.volume, headlines: d.headlines, sources: d.sources, in_universe: false };
        headlines[ticker] = { headlines: d.headlines, sources: d.sources };

        const isER = d.sources.some(s => s.includes("_er"));
        if (isER) {
          earnings_movers.push(entry);
        } else if (d.sources.includes("pm")) {
          pm_movers.push(entry);
        } else if (d.sources.includes("ah")) {
          ah_movers.push(entry);
        } else {
          // Appeared on both — put in pm
          pm_movers.push(entry);
        }
      }

      // Sort each list by |change_pct| descending
      const byChg = (a, b) => Math.abs(b.change_pct || 0) - Math.abs(a.change_pct || 0);
      earnings_movers.sort(byChg);
      pm_movers.sort(byChg);
      ah_movers.sort(byChg);

      res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
      return res.json({ ok: true, earnings_movers, pm_movers, ah_movers, headlines });
    } catch (e) {
      console.error("headlines all error:", e.message);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // Default: filter by specific tickers
  if (!tickers) {
    return res.status(400).json({ ok: false, error: "Missing ?tickers= or ?mode=all parameter" });
  }

  const tickerList = tickers.split(",").map(t => t.trim().toUpperCase()).filter(Boolean).slice(0, 50);
  if (tickerList.length === 0) {
    return res.status(400).json({ ok: false, error: "No valid tickers provided" });
  }

  try {
    const pageResults = await Promise.all(PAGES.map(fetchPage));
    const allData = mergePageResults(pageResults);

    const results = {};
    for (const t of tickerList) {
      results[t] = allData[t] || null;
    }

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.json({ ok: true, results });
  } catch (e) {
    console.error("headlines error:", e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
