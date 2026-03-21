// api/scan-scores.js — Serverless scoring engine for /scan CLI command
// Pre-computes EPS, C&A, MS scores across full universe, runs 6-filter model,
// returns compact JSON (~30-50KB) instead of 10.5MB dashboard_data.json
//
// Env vars: FMP_API_KEY (for live quotes + market data)

export const config = { maxDuration: 30 };

const FMP_BASE = "https://financialmodelingprep.com/stable";

// ── Helpers ──

function clamp(v, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, v)); }

async function fetchJson(origin, path) {
  try {
    const r = await fetch(`${origin}${path}`, { headers: { "User-Agent": "ThemePulse-Scanner" } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function fetchFmpQuotes(tickers, apiKey) {
  if (!tickers.length || !apiKey) return {};
  // FMP batch-quote supports up to ~500 at a time
  const chunks = [];
  for (let i = 0; i < tickers.length; i += 400) {
    chunks.push(tickers.slice(i, i + 400));
  }
  const map = {};
  await Promise.all(chunks.map(async (chunk) => {
    try {
      const url = `${FMP_BASE}/batch-quote?symbols=${chunk.join(",")}&apikey=${apiKey}`;
      const r = await fetch(url);
      if (!r.ok) return;
      const data = await r.json();
      (Array.isArray(data) ? data : []).forEach(q => { if (q.symbol) map[q.symbol] = q; });
    } catch {}
  }));
  return map;
}

// Percentile rank helper — binary search for O(log n) per lookup
function pctRank(arr) {
  const sorted = arr.filter(v => v != null).sort((a, b) => a - b);
  if (!sorted.length) return () => null;
  return (val) => {
    if (val == null) return null;
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (sorted[mid] <= val) lo = mid + 1; else hi = mid; }
    return Math.round(lo / sorted.length * 99);
  };
}

// ── Score computation (ported from App.jsx lines 11200-11289) ──

function computeScores(stocks) {
  // EPS Score: percentile-ranked weighted composite
  const rawScores = {};
  stocks.forEach(s => {
    const qs = s.quarters || [];
    const annuals = s.annual || [];
    rawScores[s.ticker] = {
      curEps: qs[0]?.eps_yoy ?? null,
      epsAccel: (qs[0]?.eps_yoy != null && qs[1]?.eps_yoy != null) ? qs[0].eps_yoy - qs[1].eps_yoy : null,
      curSales: qs[0]?.sales_yoy ?? null,
      annEps: annuals[0]?.eps_yoy ?? null,
      marginDelta: (() => {
        const cm = qs[0]?.net_margin ?? qs[0]?.op_margin ?? qs[0]?.gross_margin;
        const pm = qs[1]?.net_margin ?? qs[1]?.op_margin ?? qs[1]?.gross_margin;
        return (cm != null && pm != null) ? cm - pm : null;
      })(),
      posQs: qs.slice(0, 4).filter(q => q.eps_yoy != null && q.eps_yoy > 0).length,
    };
  });

  const pCE = pctRank(stocks.map(s => rawScores[s.ticker]?.curEps));
  const pAc = pctRank(stocks.map(s => rawScores[s.ticker]?.epsAccel));
  const pCS = pctRank(stocks.map(s => rawScores[s.ticker]?.curSales));
  const pAE = pctRank(stocks.map(s => rawScores[s.ticker]?.annEps));
  const pMD = pctRank(stocks.map(s => rawScores[s.ticker]?.marginDelta));
  const pPQ = pctRank(stocks.map(s => rawScores[s.ticker]?.posQs));

  // Weighted composite then re-ranked
  const composites = {};
  stocks.forEach(s => {
    const r = rawScores[s.ticker];
    const scores = [
      { p: pCE(r.curEps), w: 0.30 }, { p: pAc(r.epsAccel), w: 0.20 },
      { p: pCS(r.curSales), w: 0.15 }, { p: pAE(r.annEps), w: 0.15 },
      { p: pMD(r.marginDelta), w: 0.10 }, { p: pPQ(r.posQs), w: 0.10 },
    ];
    let tw = 0, ts = 0;
    scores.forEach(({ p, w }) => { if (p != null) { ts += p * w; tw += w; } });
    composites[s.ticker] = tw > 0 ? Math.round(ts / tw) : null;
  });
  const pFinal = pctRank(Object.values(composites).filter(v => v != null));

  const epsScores = {};
  stocks.forEach(s => { epsScores[s.ticker] = pFinal(composites[s.ticker]); });

  // MS (Momentum Score): percentile-ranked composite
  const pRS = pctRank(stocks.map(s => s.rs_rank));
  const pFrHi = pctRank(stocks.map(s => s.pct_from_high));
  const pRet3m = pctRank(stocks.map(s => s.return_3m));
  const pEPS = pctRank(stocks.map(s => epsScores[s.ticker]));
  const pADR = pctRank(stocks.map(s => s.adr_pct));

  const msComposites = {};
  stocks.forEach(s => {
    const scores = [
      { p: pRS(s.rs_rank), w: 0.30 },
      { p: pFrHi(s.pct_from_high), w: 0.20 },
      { p: pRet3m(s.return_3m), w: 0.20 },
      { p: pEPS(epsScores[s.ticker]), w: 0.20 },
      { p: pADR(s.adr_pct), w: 0.10 },
    ];
    let tw = 0, ts = 0;
    scores.forEach(({ p, w }) => { if (p != null) { ts += p * w; tw += w; } });
    msComposites[s.ticker] = tw > 0 ? Math.round(ts / tw) : null;
  });
  const pMS = pctRank(Object.values(msComposites).filter(v => v != null));

  const msScores = {};
  stocks.forEach(s => { msScores[s.ticker] = pMS(msComposites[s.ticker]); });

  // C&A Score (0-7)
  const caScores = {};
  stocks.forEach(s => {
    const qs = s.quarters || [];
    let score = null;
    if (qs[0]?.eps_yoy != null) {
      score = 0;
      if (qs[0].eps_yoy >= 25) score += 2;
      if (qs[0].sales_yoy != null && qs[0].sales_yoy >= 25) score += 2;
      if (qs[1]?.eps_yoy != null && qs[2]?.eps_yoy != null &&
          qs[0].eps_yoy > qs[1].eps_yoy && qs[1].eps_yoy > qs[2].eps_yoy) score += 2;
      if (s.roe != null && s.roe >= 0.17) score += 1;
    }
    caScores[s.ticker] = score;
  });

  return { epsScores, msScores, caScores };
}

// ── Theme clustering ──

function computeThemeClusters(stocks) {
  const clusters = {};
  stocks.forEach(s => {
    if (s.change_pct > 0 && s.themes) {
      const themes = Array.isArray(s.themes) ? s.themes : [s.themes];
      themes.forEach(t => {
        if (t) clusters[t] = (clusters[t] || 0) + 1;
      });
    }
  });
  return clusters;
}

// ── 6-Filter Model ──

function runFilters(stock, scores, themeClusters, liveQuote) {
  const filters = {};
  let total = 0;

  // Compute CR% from live OHLC if available
  let cr = null;
  if (liveQuote && liveQuote.dayHigh > liveQuote.dayLow) {
    cr = Math.round((liveQuote.price - liveQuote.dayLow) / (liveQuote.dayHigh - liveQuote.dayLow) * 100);
  }

  // Filter 1: CR (Channel Range) — live OHLC or fallback to near-high proxy
  if (cr != null && cr >= 85) {
    filters.cr = { pass: true, value: cr };
    total++;
  } else if (cr == null && stock.pct_from_high != null && stock.pct_from_high <= 5 && (stock.sma20_pct == null || stock.sma20_pct > 0)) {
    filters.cr = { pass: true, value: `proxy:${stock.pct_from_high}%fh` };
    total++;
  } else {
    filters.cr = { pass: false, value: cr ?? (stock.pct_from_high != null ? `${stock.pct_from_high}%fh` : null) };
  }

  // Filter 2: RS + MS — RS 95+ AND MS 90+
  const rs = stock.rs_rank;
  const ms = scores.msScores[stock.ticker];
  filters.rsMs = { pass: rs >= 95 && ms >= 90, rs, ms };
  if (filters.rsMs.pass) total++;

  // Filter 3: C&A — 3+
  const ca = scores.caScores[stock.ticker];
  filters.ca = { pass: ca != null && ca >= 3, value: ca };
  if (filters.ca.pass) total++;

  // Filter 4: EPS — 85+
  const eps = scores.epsScores[stock.ticker];
  filters.eps = { pass: eps != null && eps >= 85, value: eps };
  if (filters.eps.pass) total++;

  // Filter 5: RVol + Chg — RVol 1.2x+ AND Chg 3%+
  const rvol = liveQuote?.rel_volume ?? stock.rel_volume;
  const chg = liveQuote?.changePercentage ?? stock.change_pct;
  filters.rvolChg = { pass: rvol >= 1.2 && chg >= 3, rvol: Math.round(rvol * 100) / 100, chg: Math.round(chg * 100) / 100 };
  if (filters.rvolChg.pass) total++;

  // Filter 6: Theme clustering — 3+ stocks in same theme green
  const themes = Array.isArray(stock.themes) ? stock.themes : (stock.themes ? [stock.themes] : []);
  const maxCluster = themes.reduce((max, t) => Math.max(max, themeClusters[t] || 0), 0);
  const bestTheme = themes.reduce((best, t) => (themeClusters[t] || 0) > (themeClusters[best] || 0) ? t : best, themes[0] || null);
  filters.theme = { pass: maxCluster >= 3, count: maxCluster, theme: bestTheme };
  if (filters.theme.pass) total++;

  return { total, filters, cr };
}

// ── Short candidates ──

function findShorts(stocks, scores) {
  return stocks
    .filter(s => s.change_pct <= -2 || (s.short_float != null && s.short_float >= 10))
    .sort((a, b) => a.change_pct - b.change_pct)
    .slice(0, 20)
    .map(s => ({
      ticker: s.ticker,
      chg: Math.round(s.change_pct * 100) / 100,
      rvol: Math.round((s.rel_volume || 0) * 100) / 100,
      grade: s.grade || null,
      rs: s.rs_rank,
      theme: Array.isArray(s.themes) ? s.themes[0] : s.themes,
      shortFloat: s.short_float,
      offHigh: s.off_52w_high,
      eps: scores.epsScores[s.ticker],
      ms: scores.msScores[s.ticker],
    }));
}

// ── Main handler ──

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const fmpKey = process.env.FMP_API_KEY;
    if (!fmpKey) return res.status(500).json({ error: "FMP_API_KEY not configured" });

    const origin = `https://${req.headers.host}`;

    // Step 1: Fetch pipeline data (same-origin, fast)
    const dashData = await fetchJson(origin, "/dashboard_data.json");
    if (!dashData?.stocks?.length) {
      return res.status(500).json({ error: "Could not load dashboard_data.json" });
    }

    const allStocks = dashData.stocks;

    // Step 2: Compute all scores across full universe
    const scores = computeScores(allStocks);

    // Step 3: Identify candidates for live quotes
    // RS >= 85, OR change_pct >= 2%, OR EPS >= 80, OR MS >= 80
    const candidates = allStocks.filter(s =>
      s.rs_rank >= 85 || s.change_pct >= 2 ||
      (scores.epsScores[s.ticker] != null && scores.epsScores[s.ticker] >= 80) ||
      (scores.msScores[s.ticker] != null && scores.msScores[s.ticker] >= 80)
    );
    const candidateTickers = candidates.map(s => s.ticker);

    // Step 4: Fetch market indices + candidate live quotes in parallel
    const [marketQuotes, liveQuotes] = await Promise.all([
      fetchFmpQuotes(["SPY", "QQQ", "DIA", "IWM", "VIX"], fmpKey),
      fetchFmpQuotes(candidateTickers, fmpKey),
    ]);

    // Step 5: Build market context
    const market = {};
    ["SPY", "QQQ", "DIA", "IWM", "VIX"].forEach(sym => {
      const q = marketQuotes[sym];
      if (q) {
        market[sym.toLowerCase()] = {
          price: q.price,
          change: q.changePercentage != null ? Math.round(q.changePercentage * 100) / 100 : null,
          prevClose: q.previousClose,
        };
      }
    });

    // Step 6: Theme clustering
    const themeClusters = computeThemeClusters(allStocks);

    // Step 7: Run 6-filter model on candidates
    const results = [];
    candidates.forEach(s => {
      const lq = liveQuotes[s.ticker];
      // Merge live data: use live change% if available
      if (lq) {
        if (lq.changePercentage != null) s.change_pct = lq.changePercentage;
        if (lq.volume && s.avg_volume) {
          s.rel_volume = s.avg_volume > 0 ? lq.volume / s.avg_volume : s.rel_volume;
        }
      }
      const { total, filters, cr } = runFilters(s, scores, themeClusters, lq);
      if (total >= 3) {
        results.push({
          ticker: s.ticker,
          chg: Math.round((lq?.changePercentage ?? s.change_pct) * 100) / 100,
          rvol: Math.round((s.rel_volume || 0) * 100) / 100,
          score: total,
          filters,
          theme: Array.isArray(s.themes) ? s.themes[0] : s.themes,
          subtheme: Array.isArray(s.themes) && s.themes[1] ? s.themes[1] : null,
          rs: s.rs_rank,
          ms: scores.msScores[s.ticker],
          eps: scores.epsScores[s.ticker],
          ca: scores.caScores[s.ticker],
          cr,
          grade: s.grade,
          adr: s.adr_pct,
          pctFromHigh: s.pct_from_high,
          price: lq?.price ?? s.price ?? null,
        });
      }
    });

    // Sort by score desc, then chg desc
    results.sort((a, b) => b.score - a.score || b.chg - a.chg);

    // Categorize
    const earlyEntry = results.filter(r => r.score >= 5);
    const watch = results.filter(r => r.score === 4);
    const tradeFast = results.filter(r => r.score === 3);

    // Shorts
    const shorts = findShorts(allStocks, scores);

    // Stats
    const stats = {
      scanned: allStocks.length,
      candidates: candidates.length,
      earlyEntry: earlyEntry.length,
      watch: watch.length,
      tradeFast: tradeFast.length,
      skip: candidates.length - results.length,
    };

    // Timestamp
    const now = new Date();
    const ptTime = now.toLocaleString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit", hour12: true });

    return res.status(200).json({
      timestamp: now.toISOString(),
      ptTime,
      market,
      earlyEntry,
      watch,
      tradeFast,
      shorts,
      stats,
      themeClusters,
    });

  } catch (err) {
    console.error("scan-scores error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}
