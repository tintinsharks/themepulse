// api/market-quality.js — Market Quality Terminal scoring engine
// Computes Volatility, Trend, Breadth, Momentum, Macro scores → total 0-100
// Data: FMP live quotes + market_monitor.json + dashboard_data.json

export const config = { maxDuration: 15 };

// ── FOMC 2026 dates (hardcoded) ──
const FOMC_DATES = [
  "2026-01-28","2026-01-29","2026-03-18","2026-03-19",
  "2026-05-06","2026-05-07","2026-06-17","2026-06-18",
  "2026-07-29","2026-07-30","2026-09-16","2026-09-17",
  "2026-10-28","2026-10-29","2026-12-09","2026-12-10",
];

const SECTOR_ETFS = ["XLK","XLF","XLE","XLV","XLI","XLY","XLP","XLU","XLB","XLRE","XLC"];
const SECTOR_NAMES = {
  XLK:"Technology",XLF:"Financials",XLE:"Energy",XLV:"Health Care",
  XLI:"Industrials",XLY:"Cons Disc",XLP:"Cons Staples",XLU:"Utilities",
  XLB:"Materials",XLRE:"Real Estate",XLC:"Communication"
};

const INDEX_TICKERS = ["SPY","QQQ","DIA","IWM"];

function clamp(v, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, v)); }
function pct(v, lo, hi) { return clamp(((v - lo) / (hi - lo)) * 100); }

// ── Fetch FMP batch quotes ──
async function fetchQuotes(tickers, apiKey) {
  const url = `https://financialmodelingprep.com/stable/batch-quote?symbols=${tickers.join(",")}&apikey=${apiKey}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return {};
    const data = await r.json();
    const map = {};
    (Array.isArray(data) ? data : []).forEach(q => { if (q.symbol) map[q.symbol] = q; });
    return map;
  } catch { return {}; }
}

// ── Fetch JSON from own origin ──
async function fetchJson(origin, path) {
  try {
    const r = await fetch(`${origin}${path}`, { headers: { "User-Agent": "ThemePulse-Internal" } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ── Scoring functions ──

function scoreVolatility(vix) {
  if (!vix) return { score: 50, details: {} };
  const level = vix.price || 20;
  const change = vix.changePercentage || 0;

  // VIX level score: lower = better for swing trading
  let levelScore;
  if (level < 13) levelScore = 100;
  else if (level < 16) levelScore = 85;
  else if (level < 20) levelScore = 70;
  else if (level < 25) levelScore = 45;
  else if (level < 30) levelScore = 20;
  else levelScore = 5;

  // VIX trend: falling = good
  let trendLabel, trendAdj;
  if (change < -3) { trendLabel = "Falling"; trendAdj = 10; }
  else if (change < -0.5) { trendLabel = "Easing"; trendAdj = 5; }
  else if (change < 1) { trendLabel = "Stable"; trendAdj = 0; }
  else if (change < 5) { trendLabel = "Rising"; trendAdj = -10; }
  else { trendLabel = "Spiking"; trendAdj = -20; }

  // VIX 1Y percentile (approximate from level)
  let percentile;
  if (level < 12) percentile = 5;
  else if (level < 14) percentile = 15;
  else if (level < 16) percentile = 25;
  else if (level < 18) percentile = 40;
  else if (level < 20) percentile = 50;
  else if (level < 23) percentile = 65;
  else if (level < 27) percentile = 80;
  else if (level < 35) percentile = 90;
  else percentile = 97;

  // Put/Call estimate from VIX regime
  let putCall, putCallLabel;
  if (level < 16) { putCall = 0.75; putCallLabel = "Normal"; }
  else if (level < 22) { putCall = 0.88; putCallLabel = "Moderate"; }
  else if (level < 28) { putCall = 0.95; putCallLabel = "Fear elevated"; }
  else { putCall = 1.15; putCallLabel = "Extreme fear"; }

  const score = clamp(levelScore + trendAdj);

  return {
    score,
    details: {
      vix_level: { value: level.toFixed(2), label: level < 16 ? "Low" : level < 22 ? "Normal" : level < 28 ? "High" : "Extreme" },
      vix_trend: { value: `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`, label: trendLabel },
      vix_1y_pct: { value: `${percentile}th`, label: percentile < 25 ? "Low" : percentile < 50 ? "Normal" : percentile < 75 ? "Elevated" : "High" },
      put_call: { value: putCall.toFixed(2), label: putCallLabel },
    }
  };
}

function scoreTrend(quotes, monitor) {
  const spy = quotes.SPY || {};
  const qqq = quotes.QQQ || {};
  const indices = monitor?.indices || {};
  const spyMa = indices.SPY || {};
  const qqqMa = indices.QQQ || {};

  let score = 0;
  const details = {};

  // SPX vs 20d
  const above20 = spyMa.above_ema21 ?? (spy.price > (spyMa.ema21 || 0));
  details.spx_vs_20d = { value: above20 ? "Above" : "Below", label: above20 ? "Healthy" : "Weak" };
  if (above20) score += 20;

  // SPX vs 50d
  const above50 = spyMa.above_sma50 ?? true;
  details.spx_vs_50d = { value: above50 ? "Above" : "Below", label: above50 ? "Healthy" : "Weak" };
  if (above50) score += 25;

  // SPX vs 200d
  const above200 = spyMa.above_sma200 ?? true;
  details.spx_vs_200d = { value: above200 ? "Above" : "Intact", label: above200 ? "Intact" : "Broken" };
  if (above200) score += 25;

  // QQQ trend
  const qAbove50 = qqqMa.above_sma50 ?? true;
  const qqqTrendLabel = qAbove50 ? (qqqMa.above_ema21 ? "Strong" : "Above") : "Below";
  details.qqq_trend = { value: `${qAbove50 ? "Above" : "Below"} 50d`, label: qqqTrendLabel };
  if (qAbove50) score += 15;

  // Regime
  const allAbove = above20 && above50 && above200;
  const allBelow = !above20 && !above50;
  let regime;
  if (allAbove) { regime = "Uptrend"; score += 15; }
  else if (allBelow && !above200) { regime = "Downtrend"; }
  else if (!above20 && above50) { regime = "Correcting"; score += 5; }
  else { regime = "Chop"; score += 8; }
  details.regime = { value: regime, label: regime === "Uptrend" ? "Healthy" : regime === "Correcting" ? "Correcting" : regime === "Chop" ? "Mixed" : "Risk-off" };

  return { score: clamp(score), details };
}

function scoreBreadth(monitor, dashData) {
  const details = {};
  let score = 0;

  // Compute breadth from dashboard_data if available
  let pctAbove50 = 50, pctAbove200 = 50, pctAbove20 = 50;
  let above50Count = 0, above200Count = 0, advCount = 0, decCount = 0, nhCount = 0, nlCount = 0, total = 0;
  if (dashData?.stocks?.length > 0) {
    const stocks = dashData.stocks;
    total = stocks.length;
    above50Count = stocks.filter(s => s.above_50ma === 1 || s.sma50_above === 1).length;
    above200Count = stocks.filter(s => s.above_200ma === 1 || s.sma200_above === 1).length;
    pctAbove50 = Math.round(above50Count / total * 100);
    pctAbove200 = Math.round(above200Count / total * 100);
    pctAbove20 = Math.round(stocks.filter(s => s.sma20_above === 1).length / total * 100);
    advCount = stocks.filter(s => (s.change_pct || 0) > 0).length;
    decCount = total - advCount;
    nhCount = stocks.filter(s => (s.pct_from_high || -999) >= -1).length;
    nlCount = stocks.filter(s => (s.pct_from_high || 0) <= -50).length;
  }

  // % above 50d MA (strongest signal)
  const b50Label = pctAbove50 > 65 ? "Healthy" : pctAbove50 > 50 ? "Weak" : pctAbove50 > 35 ? "Very weak" : "Washout";
  details.pct_above_50d = { value: `${pctAbove50}%`, label: b50Label };
  score += pct(pctAbove50, 20, 80) * 0.35;

  // % above 200d MA
  const b200Label = pctAbove200 > 70 ? "Healthy" : pctAbove200 > 55 ? "Moderate" : "Weak";
  details.pct_above_200d = { value: `${pctAbove200}%`, label: b200Label };
  score += pct(pctAbove200, 30, 85) * 0.30;

  // % above 20d MA
  const b20Label = pctAbove20 > 60 ? "Healthy" : pctAbove20 > 45 ? "Moderate" : "Very weak";
  details.pct_above_20d = { value: `${pctAbove20}%`, label: b20Label };
  score += pct(pctAbove20, 20, 75) * 0.20;

  // NYSE A/D approximation from monitor gauges
  const gauges = monitor?.gauges || {};
  const t2108 = parseFloat(gauges.t2108) || 50;
  const adLabel = t2108 > 55 ? "Positive" : t2108 > 45 ? "Neutral" : "Negative";
  details.nyse_ad = { value: `${t2108.toFixed(1)}%`, label: adLabel };
  score += pct(t2108, 25, 75) * 0.10;

  // NAS Highs/Lows from gauges
  const up4 = parseFloat(gauges.up_4pct) || 0;
  const down4 = parseFloat(gauges.down_4pct) || 0;
  const hlRatio = down4 > 0 ? (up4 / down4).toFixed(1) : up4 > 0 ? "∞" : "0";
  const hlLabel = (up4 / Math.max(down4, 1)) > 2 ? "Bulls dominate" : (up4 / Math.max(down4, 1)) > 1 ? "Mixed" : "Lows dominate";
  details.nas_highs_lows = { value: `${hlRatio}:1`, label: hlLabel };
  score += pct(up4 / Math.max(down4, 1), 0.3, 3) * 0.05;

  const advPct = total > 0 ? Math.round(advCount / total * 100) : 50;
  const decPct = total > 0 ? 100 - advPct : 50;
  const nhPct = total > 0 ? Math.round(nhCount / total * 100) : 0;
  const nlPct = total > 0 ? Math.round(nlCount / total * 100) : 0;

  const breadthStats = {
    advancing: { pct: advPct, count: advCount },
    declining: { pct: decPct, count: decCount },
    newHigh: { pct: nhPct, count: nhCount },
    newLow: { pct: nlPct, count: nlCount },
    sma50Above: { pct: pctAbove50, count: above50Count },
    sma50Below: { pct: 100 - pctAbove50, count: total - above50Count },
    sma200Above: { pct: pctAbove200, count: above200Count },
    sma200Below: { pct: 100 - pctAbove200, count: total - above200Count },
  };

  return { score: clamp(Math.round(score)), details, breadthStats };
}

function scoreMomentum(sectorQuotes) {
  const sectors = SECTOR_ETFS.map(tk => ({
    ticker: tk,
    name: SECTOR_NAMES[tk],
    change: sectorQuotes[tk]?.changePercentage ?? 0,
  })).sort((a, b) => b.change - a.change);

  const positive = sectors.filter(s => s.change > 0).length;
  const leader = sectors[0] || { name: "N/A", change: 0 };
  const laggard = sectors[sectors.length - 1] || { name: "N/A", change: 0 };

  // Participation score
  const participationScore = pct(positive, 0, 11) * 0.5;

  // Spread between top 3 and bottom 3
  const top3Avg = sectors.slice(0, 3).reduce((s, x) => s + x.change, 0) / 3;
  const bot3Avg = sectors.slice(-3).reduce((s, x) => s + x.change, 0) / 3;
  const spread = top3Avg - bot3Avg;

  // Leadership quality
  const leadershipScore = leader.change > 0 ? Math.min(leader.change * 10, 25) : 0;

  const score = clamp(Math.round(participationScore + leadershipScore + (positive > 6 ? 25 : positive > 3 ? 15 : 0)));

  return {
    score,
    details: {
      sectors_positive: { value: `${positive}/11`, label: positive > 7 ? "Broad" : positive > 4 ? "Mixed" : "Very thin" },
      leader: { value: leader.name, label: `${leader.change >= 0 ? "+" : ""}${leader.change.toFixed(2)}%` },
      laggard: { value: laggard.name, label: `${laggard.change.toFixed(2)}%` },
      participation: { value: positive > 7 ? "High" : positive > 4 ? "Moderate" : "Low", label: positive > 7 ? "Broad" : "Narrow" },
    },
    sectors,
  };
}

function scoreMacro(quotes) {
  let score = 70; // start neutral-positive
  const details = {};

  // FOMC proximity
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  let fomcDays = 999;
  let fomcLabel = "";
  for (const d of FOMC_DATES) {
    const diff = (new Date(d) - today) / 86400000;
    if (diff >= -1 && diff < fomcDays) { fomcDays = diff; }
  }
  if (fomcDays <= 0) { fomcLabel = "TODAY"; score -= 20; }
  else if (fomcDays <= 1) { fomcLabel = "Tomorrow"; score -= 15; }
  else if (fomcDays <= 3) { fomcLabel = `${Math.ceil(fomcDays)}d away`; score -= 8; }
  else { fomcLabel = `${Math.ceil(fomcDays)}d away`; }
  const fomcRisk = fomcDays <= 1 ? "Event risk!" : fomcDays <= 3 ? "Caution" : "Clear";
  details.fomc = { value: fomcLabel, label: fomcRisk };

  // 10Y yield (TNX)
  const tnx = quotes["^TNX"] || quotes.TNX || {};
  const yieldVal = tnx.price || 4.0;
  const yieldChg = tnx.changePercentage || 0;
  const yieldTrend = yieldChg > 1 ? "Rising" : yieldChg < -1 ? "Falling" : "Stable";
  details.yield_10y = { value: `${yieldVal.toFixed(2)}%`, label: yieldTrend };
  if (yieldChg > 2) score -= 10;
  else if (yieldChg < -1) score += 5;

  // DXY
  const dxy = quotes.DX || quotes.UUP || {};
  const dxyVal = dxy.price || 100;
  const dxyChg = dxy.changePercentage || 0;
  const dxyTrend = dxyChg > 0.3 ? "Strengthening" : dxyChg < -0.3 ? "Weakening" : "Stable";
  details.dxy = { value: dxyVal.toFixed(2), label: dxyTrend };
  if (dxyChg > 1) score -= 5;

  // Fed stance (hardcoded for current cycle)
  details.fed_stance = { value: "Hold", label: "3.50-3.75%" };

  // Geopolitical (hardcoded — update as needed)
  details.geopolitical = { value: "Moderate", label: "Monitor" };

  return { score: clamp(score), details };
}

function scoreExecution(monitor, dashData) {
  let score = 50;
  const details = {};
  const gauges = monitor?.gauges || {};

  // Breakouts working? (up_4pct > 200 = healthy)
  const up4 = parseFloat(gauges.up_4pct) || 0;
  const breakouts = up4 > 300 ? "Yes" : up4 > 150 ? "Moderate" : "No";
  const breakoutsLabel = up4 > 300 ? "Healthy" : up4 > 150 ? "Selective" : "Failing";
  details.breakouts_working = { value: breakouts, label: breakoutsLabel };
  if (up4 > 300) score += 15;
  else if (up4 > 150) score += 5;
  else score -= 10;

  // Leaders holding? (ratio_5d > 2 = leaders holding)
  const ratio5d = parseFloat(gauges.ratio_5d) || 1;
  const leaders = ratio5d > 2.5 ? "Yes" : ratio5d > 1.5 ? "Moderate" : "No";
  const leadersLabel = ratio5d > 2.5 ? "Strong" : ratio5d > 1.5 ? "Mixed" : "Fading";
  details.leaders_holding = { value: leaders, label: leadersLabel };
  if (ratio5d > 2.5) score += 15;
  else if (ratio5d > 1.5) score += 5;
  else score -= 10;

  // Pullbacks bought? (t2108 > 50 and positive trend)
  const t2108 = parseFloat(gauges.t2108) || 50;
  const pullbacks = t2108 > 55 ? "Yes" : t2108 > 40 ? "Selective" : "No";
  const pullbacksLabel = t2108 > 55 ? "Support" : t2108 > 40 ? "Weak" : "No support";
  details.pullbacks_bought = { value: pullbacks, label: pullbacksLabel };
  if (t2108 > 55) score += 10;
  else if (t2108 < 40) score -= 10;

  // Follow-through (ratio_10d strength)
  const ratio10d = parseFloat(gauges.ratio_10d) || 1;
  const followLabel = ratio10d > 2 ? "Strong" : ratio10d > 1.3 ? "Moderate" : "Weak";
  const followConviction = ratio10d > 2 ? "High conviction" : ratio10d > 1.3 ? "Moderate" : "Low conviction";
  details.follow_through = { value: followLabel, label: followConviction };
  if (ratio10d > 2) score += 10;
  else if (ratio10d < 1) score -= 10;

  return { score: clamp(score), details };
}

function generateAnalysis(total, scores, decision) {
  const { volatility, trend, breadth, momentum, macro, execution } = scores;
  const parts = [];

  if (decision === "NO") {
    parts.push(`**AVOID TRADING.** The current environment scores ${total}/100 — well below the 60-point threshold for active swing trading.`);
  } else if (decision === "CAUTION") {
    parts.push(`**SELECTIVE TRADING ONLY.** The environment scores ${total}/100 — in the caution zone. Limit to A+ setups with reduced position sizes.`);
  } else {
    parts.push(`**GREEN LIGHT.** The environment scores ${total}/100 — conditions favor active swing trading with normal position sizing.`);
  }

  // Breadth commentary
  if (breadth.score < 40) {
    const b50 = breadth.details.pct_above_50d?.value || "N/A";
    parts.push(`Market breadth is deteriorating: ${b50} of stocks trade above their 50-day moving average.`);
  } else if (breadth.score > 70) {
    parts.push(`Breadth is healthy and supportive of new positions.`);
  }

  // Volatility
  if (volatility.score < 40) {
    const vl = volatility.details.vix_level?.value || "N/A";
    parts.push(`VIX at ${vl} signals elevated fear and wider stops required.`);
  }

  // Momentum
  const secPos = momentum.details.sectors_positive?.value || "N/A";
  parts.push(`${secPos} sectors are positive — ${momentum.details.leader?.value || "N/A"} leads at ${momentum.details.leader?.label || ""}.`);

  // FOMC
  if (macro.details.fomc?.label === "Event risk!" || macro.details.fomc?.label === "Caution") {
    parts.push(`FOMC rate decision is ${macro.details.fomc?.value} — injecting event risk.`);
  }

  // Suggested action
  if (decision === "NO") {
    parts.push(`Suggested action: Sit on hands. Wait for breadth to improve and VIX to settle before re-engaging. Capital preservation is the priority.`);
  } else if (decision === "CAUTION") {
    parts.push(`Suggested action: Reduce position sizes by 50%. Only take setups with clear institutional-quality bases and volume confirmation.`);
  } else {
    parts.push(`Suggested action: Trade with conviction. Favor momentum leaders in strong themes. Use normal position sizing.`);
  }

  return parts.join(" ");
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

    // Parallel fetches
    const [quotes, monitor, dashData, userData] = await Promise.all([
      fetchQuotes([...INDEX_TICKERS, ...SECTOR_ETFS, "VIXY", "UUP"], fmpKey),
      fetchJson(origin, "/market_monitor.json"),
      fetchJson(origin, "/dashboard_data.json"),
      (async () => {
        // Fetch userdata directly from Upstash Redis (bypasses auth)
        const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
        const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
        if (!upstashUrl || !upstashToken) return { portfolio: [], watchlist: [] };
        try {
          const r = await fetch(upstashUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${upstashToken}`, "Content-Type": "application/json" },
            body: JSON.stringify(["GET", "tp_userdata"]),
          });
          const result = await r.json();
          return result.result ? JSON.parse(result.result) : { portfolio: [], watchlist: [] };
        } catch { return { portfolio: [], watchlist: [] }; }
      })(),
    ]);

    // Also try to get VIX directly
    let vixQuote = quotes.VIXY || null;
    // If we have VIXY, estimate VIX from it (VIXY tracks VIX short-term futures)
    // Better: use FMP index quote
    try {
      const vixResp = await fetch(`https://financialmodelingprep.com/api/v3/quote/%5EVIX?apikey=${fmpKey}`);
      if (vixResp.ok) {
        const vd = await vixResp.json();
        if (Array.isArray(vd) && vd[0]) vixQuote = vd[0];
      }
    } catch {}

    // Try TNX
    let tnxQuote = null;
    try {
      const tnxResp = await fetch(`https://financialmodelingprep.com/api/v3/quote/%5ETNX?apikey=${fmpKey}`);
      if (tnxResp.ok) {
        const td = await tnxResp.json();
        if (Array.isArray(td) && td[0]) tnxQuote = td[0];
      }
    } catch {}

    // Score each dimension
    const volatility = scoreVolatility(vixQuote);
    const trend = scoreTrend(quotes, monitor);
    const breadth = scoreBreadth(monitor, dashData);
    const momentum = scoreMomentum(quotes);
    const macro = scoreMacro({ ...quotes, "^TNX": tnxQuote });
    const execution = scoreExecution(monitor, dashData);

    // Weighted total
    const total = Math.round(
      volatility.score * 0.25 +
      momentum.score * 0.25 +
      trend.score * 0.20 +
      breadth.score * 0.20 +
      macro.score * 0.10
    );

    // Decision
    let decision, positionSize;
    if (total >= 80) { decision = "YES"; positionSize = "FULL"; }
    else if (total >= 60) { decision = "CAUTION"; positionSize = "REDUCED"; }
    else if (total >= 40) { decision = "NO"; positionSize = "MINIMAL"; }
    else { decision = "NO"; positionSize = "NONE"; }

    const scores = { volatility, trend, breadth, momentum, macro, execution };
    const analysis = generateAnalysis(total, scores, decision);

    // Build themeHealth
    const themeHealth = [];
    if (dashData?.themes?.length > 0 && dashData?.stocks?.length > 0) {
      const stockMap = {};
      dashData.stocks.forEach(s => { stockMap[s.ticker] = s; });
      dashData.themes.slice(0, 40).forEach(theme => {
        // Collect all tickers for this theme across subthemes
        const allTickers = [];
        (theme.subthemes || []).forEach(sub => {
          (sub.tickers || []).forEach(tk => { if (!allTickers.includes(tk)) allTickers.push(tk); });
        });
        const stocks = allTickers.map(tk => stockMap[tk]).filter(Boolean);
        if (stocks.length === 0) return;
        const greenCount = stocks.filter(s => (s.change_pct || 0) > 0).length;
        const avgReturn1w = stocks.reduce((sum, s) => sum + (s.return_1w || 0), 0) / stocks.length;
        const avgReturn1m = stocks.reduce((sum, s) => sum + (s.return_1m || 0), 0) / stocks.length;
        const avgReturn3m = stocks.reduce((sum, s) => sum + (s.return_3m || 0), 0) / stocks.length;

        // Composite Theme Strength Score (0-100)
        // Momentum (30%): avg 1w + 1m returns normalized
        const momScore = clamp(50 + avgReturn1w * 3 + avgReturn1m * 0.5, 0, 100);
        // Money Flow (25%): % of stocks with positive relative volume (RVol > 1)
        const rvolPositive = stocks.filter(s => (s.rel_volume || 0) > 1).length;
        const moneyFlowScore = clamp(rvolPositive / stocks.length * 100, 0, 100);
        // Strong Stocks (25%): % above 50 SMA + near highs
        const above50 = stocks.filter(s => s.above_50ma === 1 || s.sma50_above === 1).length;
        const nearHighs = stocks.filter(s => (s.pct_from_high || -100) >= -10).length;
        const strongScore = clamp((above50 / stocks.length * 50) + (nearHighs / stocks.length * 50), 0, 100);
        // Multi-Timeframe (20%): 3-month return normalized
        const mtfScore = clamp(50 + avgReturn3m * 0.3, 0, 100);

        const compositeScore = Math.round(momScore * 0.30 + moneyFlowScore * 0.25 + strongScore * 0.25 + mtfScore * 0.20);

        // Compute composite for subthemes too
        const subthemes = (theme.subthemes || []).map(sub => {
          const subStocks = (sub.tickers || []).map(tk => stockMap[tk]).filter(Boolean);
          if (subStocks.length === 0) return null;
          const subGreen = subStocks.filter(s => (s.change_pct || 0) > 0).length;
          const subAvg1w = subStocks.reduce((sum, s) => sum + (s.return_1w || 0), 0) / subStocks.length;
          const subAvg1m = subStocks.reduce((sum, s) => sum + (s.return_1m || 0), 0) / subStocks.length;
          const subAvg3m = subStocks.reduce((sum, s) => sum + (s.return_3m || 0), 0) / subStocks.length;
          const subRvol = subStocks.filter(s => (s.rel_volume || 0) > 1).length;
          const subAbove50 = subStocks.filter(s => s.above_50ma === 1 || s.sma50_above === 1).length;
          const subNearHi = subStocks.filter(s => (s.pct_from_high || -100) >= -10).length;
          const sMom = clamp(50 + subAvg1w * 3 + subAvg1m * 0.5, 0, 100);
          const sMF = clamp(subRvol / subStocks.length * 100, 0, 100);
          const sStr = clamp((subAbove50 / subStocks.length * 50) + (subNearHi / subStocks.length * 50), 0, 100);
          const sMTF = clamp(50 + subAvg3m * 0.3, 0, 100);
          const subScore = Math.round(sMom * 0.30 + sMF * 0.25 + sStr * 0.25 + sMTF * 0.20);
          // Include top tickers sorted by RS rank
          const subTickers = subStocks
            .map(s => ({ ticker: s.ticker, company: s.company || '', rs: s.rs_rank || 0, chg: Math.round((s.change_pct || 0) * 100) / 100, ret1w: Math.round((s.return_1w || 0) * 100) / 100, ret1m: Math.round((s.return_1m || 0) * 100) / 100, ret3m: Math.round((s.return_3m || 0) * 100) / 100, fromHigh: Math.round((s.pct_from_high || s.off_52w_high || 0) * 10) / 10 }))
            .sort((a, b) => b.rs - a.rs)
            .slice(0, 20);
          return {
            name: sub.name,
            stockCount: subStocks.length,
            pctGreen: Math.round(subGreen / subStocks.length * 100),
            score: subScore,
            tickers: subTickers,
          };
        }).filter(Boolean);

        themeHealth.push({
          theme: theme.theme,
          stockCount: stocks.length,
          pctGreen: Math.round(greenCount / stocks.length * 100),
          score: compositeScore,
          subthemes,
        });
      });
      themeHealth.sort((a, b) => b.score - a.score);
      themeHealth.splice(20); // limit to top 20
    }

    // Build ticker tape
    const tape = [...INDEX_TICKERS, ...SECTOR_ETFS].map(tk => {
      const q = quotes[tk];
      if (!q) return null;
      return {
        ticker: tk,
        price: q.price?.toFixed(2),
        change: q.changePercentage?.toFixed(2),
      };
    }).filter(Boolean);

    // Add VIX to tape
    if (vixQuote) {
      tape.splice(1, 0, {
        ticker: "VIX",
        price: (vixQuote.price || 0).toFixed(2),
        change: (vixQuote.changePercentage || 0).toFixed(2),
      });
    }
    // Add TNX
    if (tnxQuote) {
      tape.splice(2, 0, {
        ticker: "TNX",
        price: (tnxQuote.price || 0).toFixed(2),
        change: (tnxQuote.changePercentage || 0).toFixed(2),
      });
    }
    // Add DXY proxy
    if (quotes.UUP) {
      tape.splice(3, 0, {
        ticker: "DXY",
        price: (quotes.UUP.price || 0).toFixed(2),
        change: (quotes.UUP.changePercentage || 0).toFixed(2),
      });
    }

    // Build pre-market briefing text
    const briefingLines = [];
    // Critical warnings
    if (total < 40) briefingLines.push(`⚠️ TERMINAL SAYS NO (${total}/100) — SIT ON HANDS. Capital preservation mode.`);
    else if (total < 60) briefingLines.push(`⚠️ CAUTION (${total}/100) — Reduce size, be selective.`);
    else briefingLines.push(`✅ TERMINAL SAYS YES (${total}/100) — Full aggression.`);

    // Market status
    const vixLevel = vixQuote?.price?.toFixed(1) || "N/A";
    const b50 = breadth.breadthStats?.sma50Above?.pct || "?";
    briefingLines.push(`VIX: ${vixLevel} | Breadth: ${b50}% above 50MA | Position: ${positionSize}`);

    // Top themes
    if (themeHealth.length > 0) {
      const top3 = themeHealth.slice(0, 3).map(t => `${t.theme} (${t.score})`).join(", ");
      briefingLines.push(`Hottest themes: ${top3}`);
    }

    // Gold star candidates (top stocks in multiple timeframes)
    if (dashData?.stocks?.length > 0) {
      const valid = dashData.stocks.filter(s => s.return_1m && s.return_3m && s.return_6m && (s.avg_dollar_vol_raw || 0) > 1000000);
      const n = valid.length;
      if (n > 0) {
        const top5_1m = new Set(valid.sort((a, b) => (b.return_1m || 0) - (a.return_1m || 0)).slice(0, Math.max(n / 20, 1)).map(s => s.ticker));
        const top5_3m = new Set(valid.sort((a, b) => (b.return_3m || 0) - (a.return_3m || 0)).slice(0, Math.max(n / 20, 1)).map(s => s.ticker));
        const top5_6m = new Set(valid.sort((a, b) => (b.return_6m || 0) - (a.return_6m || 0)).slice(0, Math.max(n / 20, 1)).map(s => s.ticker));
        const gold = [...top5_1m].filter(t => top5_3m.has(t) && top5_6m.has(t));
        if (gold.length > 0) {
          briefingLines.push(`★ Gold star candidates (${gold.length}): ${gold.slice(0, 8).join(", ")}`);
        }
      }
    }

    // EP movers
    const ahMovers = dashData?.ah_earnings_movers || [];
    const pmMovers = dashData?.pm_earnings_movers || [];
    const epCount = ahMovers.length + pmMovers.length;
    if (epCount > 0) {
      const topEP = [...ahMovers, ...pmMovers].sort((a, b) => Math.abs(b.change_pct || 0) - Math.abs(a.change_pct || 0)).slice(0, 3);
      const epStr = topEP.map(m => `${m.ticker} ${(m.change_pct || 0) >= 0 ? "+" : ""}${(m.change_pct || 0).toFixed(1)}%`).join(", ");
      briefingLines.push(`EP movers (${epCount}): ${epStr}`);
    }

    const briefing = briefingLines.join("\n");

    // Build EP/SIP candidates for the day
    const ahSip = dashData?.ah_sip_movers || dashData?.ah_top_movers || [];
    const pmSip = dashData?.pm_sip_movers || dashData?.pm_top_movers || [];
    const allEpSip = [...ahMovers, ...pmMovers, ...ahSip, ...pmSip];
    const epCandidates = allEpSip
      .filter(m => Math.abs(m.change_pct || m.ext_hours_change_pct || 0) >= 3)
      .sort((a, b) => Math.abs(b.change_pct || b.ext_hours_change_pct || 0) - Math.abs(a.change_pct || a.ext_hours_change_pct || 0))
      .slice(0, 15)
      .map(m => ({
        ticker: m.ticker,
        company: m.company || '',
        chg: Math.round((m.change_pct || m.ext_hours_change_pct || 0) * 100) / 100,
        volume: m.volume || 0,
        category: m.category || (m.er ? 'CAT' : 'SIP'),
        magna: m.magna_score ?? null,
        epQuality: m.ep_quality ?? null,
        epLabel: m.ep_quality_label || null,
        session: m.session || (ahMovers.includes(m) || ahSip.includes(m) ? 'AH' : 'PM'),
        headlines: (m.recent_headlines || m.headlines || []).slice(0, 1).map(h => typeof h === 'string' ? h : h.title || h.text || ''),
      }));

    // Build portfolio & watchlist live view data
    const stockMap = {};
    if (dashData?.stocks?.length > 0) {
      dashData.stocks.forEach(s => { stockMap[s.ticker] = s; });
    }
    const portfolioTickers = userData?.portfolio || [];
    const watchlistTickers = userData?.watchlist || [];

    // Fetch live quotes for portfolio/watchlist tickers not already in quotes
    const liveTickers = [...new Set([...portfolioTickers, ...watchlistTickers])].filter(tk => !quotes[tk]);
    if (liveTickers.length > 0) {
      const liveQuotes = await fetchQuotes(liveTickers, fmpKey);
      Object.assign(quotes, liveQuotes);
    }

    const buildLiveRow = (tk) => ({
      ticker: tk,
      company: stockMap[tk]?.company || '',
      price: quotes[tk]?.price || stockMap[tk]?.close || 0,
      chg: quotes[tk]?.changePercentage ?? stockMap[tk]?.change_pct ?? 0,
      ret1w: stockMap[tk]?.return_1w || 0,
      rs: stockMap[tk]?.rs_rank || 0,
      theme: stockMap[tk]?.themes?.[0]?.theme || '',
      subtheme: stockMap[tk]?.themes?.[0]?.subtheme || stockMap[tk]?.themes?.[0]?.theme || '',
      rvol: stockMap[tk]?.rel_volume || quotes[tk]?.volume / (stockMap[tk]?.avg_volume_raw || 1) || 0,
    });

    const portfolio = portfolioTickers.map(buildLiveRow);
    const watchlist = watchlistTickers.map(buildLiveRow);

    // Group portfolio + watchlist by subtheme
    const allLive = [...(portfolio || []), ...(watchlist || [])];
    const liveGroups = {};
    allLive.forEach(s => {
      const theme = s.theme || 'Ungrouped';
      const subtheme = s.subtheme || theme;
      if (!liveGroups[subtheme]) liveGroups[subtheme] = { name: subtheme, theme, stocks: [] };
      liveGroups[subtheme].stocks.push(s);
    });
    // Compute group-level metrics
    const liveGrouped = Object.values(liveGroups).map(g => {
      const avgChg = g.stocks.reduce((s, st) => s + (st.chg || 0), 0) / g.stocks.length;
      const avgRvol = g.stocks.reduce((s, st) => s + (st.rvol || 0), 0) / g.stocks.length;
      return { ...g, avgChg: Math.round(avgChg * 100) / 100, avgRvol: Math.round(avgRvol * 10) / 10, count: g.stocks.length };
    }).sort((a, b) => b.avgChg - a.avgChg);

    return res.status(200).json({
      ok: true,
      timestamp: new Date().toISOString(),
      decision,
      total,
      position_size: positionSize,
      scores,
      execution,
      analysis,
      briefing,
      tape,
      sectors: momentum.sectors,
      weights: { volatility: 25, momentum: 25, trend: 20, breadth: 20, macro: 10 },
      breadthStats: breadth.breadthStats,
      themeHealth,
      quadrant: (() => {
        // Compute live from dashboard_data instead of nightly market_monitor
        const stocks = dashData?.stocks || [];
        const total = stocks.length || 1;
        const date = new Date().toLocaleDateString();

        // 4% movers (live from change_pct)
        const up4 = stocks.filter(s => (s.change_pct || 0) >= 4).length;
        const dn4 = stocks.filter(s => (s.change_pct || 0) <= -4).length;

        // T2108: % above 40-day MA (approximate from above_50ma since we don't have 40d)
        const above40 = stocks.filter(s => s.above_50ma === 1 || s.sma50_above === 1).length;
        const t = Math.round(above40 / total * 100 * 10) / 10;

        // 25% quarter movers (from return_3m)
        const up25q = stocks.filter(s => (s.return_3m || 0) >= 25).length;
        const dn25q = stocks.filter(s => (s.return_3m || 0) <= -25).length;

        // 25% month movers (from return_1m)
        const up25m = stocks.filter(s => (s.return_1m || 0) >= 25).length;
        const dn25m = stocks.filter(s => (s.return_1m || 0) <= -25).length;

        // 5d ratio: must come from market_monitor history (requires 5 days of data)
        const r5d = monitor?.current?.ratio_5d ?? null;

        // Regime (use r5d if available, else fall back to t2108 + breadth only)
        const r5dVal = r5d ?? 0;
        let regime, regimeColor;
        if (r5dVal >= 2 && t >= 50) { regime = "AGGRESSIVE"; regimeColor = "#00d26a"; }
        else if (r5dVal >= 1 && t >= 40) { regime = "BULLISH"; regimeColor = "#00d26a"; }
        else if (r5dVal >= 0.5 && t >= 30) { regime = "CAUTIOUS"; regimeColor = "#ffa726"; }
        else { regime = "DEFENSIVE"; regimeColor = "#ff4757"; }
        const regimeScore = r5dVal >= 2 ? 4 : r5dVal >= 1 ? 3 : r5dVal >= 0.5 ? 2 : 1;

        return {
          date, regime, regimeColor, regimeScore,
          gauges: [
            { label: "4% Up", value: up4, color: up4 >= 200 ? "#00d26a" : up4 >= 100 ? "#ffa726" : "#ff4757" },
            { label: "4% Dn", value: dn4, color: dn4 <= 100 ? "#00d26a" : dn4 <= 200 ? "#ffa726" : "#ff4757" },
            { label: "5d Ratio", value: r5d !== null ? r5dVal : "N/A", color: r5dVal >= 1.5 ? "#00d26a" : r5dVal >= 0.5 ? "#ffa726" : "#ff4757" },
            { label: "T2108", value: t + "%", color: t >= 50 ? "#00d26a" : t >= 30 ? "#ffa726" : "#ff4757" },
            { label: "25%Q↑", value: up25q, color: up25q >= 300 ? "#00d26a" : up25q >= 100 ? "#ffa726" : "#ff4757" },
            { label: "25%Q↓", value: dn25q, color: dn25q <= 200 ? "#00d26a" : dn25q <= 400 ? "#ffa726" : "#ff4757" },
            { label: "25%M↑", value: up25m, color: up25m >= 50 ? "#00d26a" : up25m >= 20 ? "#ffa726" : "#ff4757" },
            { label: "25%M↓", value: dn25m, color: dn25m <= 30 ? "#00d26a" : dn25m <= 80 ? "#ffa726" : "#ff4757" },
          ],
        };
      })(),
      trend: (() => {
        // Build trend data from market_monitor history
        const history = monitor?.history || [];
        const last3 = history.slice(-3).reverse();
        const indices = monitor?.indices || {};
        // Compute net new highs from dashboard_data
        const stocks = dashData?.stocks || [];
        const totalStocks = stocks.length || 1;
        const nearHigh = stocks.filter(s => (s.pct_from_high || -100) >= -1).length;
        const nearLow = stocks.filter(s => (s.pct_from_high || -100) <= -50).length;
        const nnh = nearHigh - nearLow;
        const above50 = stocks.filter(s => s.above_50ma === 1 || s.sma50_above === 1).length;
        const above200 = stocks.filter(s => s.above_200ma === 1).length;
        const pct50 = Math.round(above50 / totalStocks * 100);
        const pct200 = Math.round(above200 / totalStocks * 100);
        // Trend status
        const status = nnh < 0 ? "DOWN" : nnh > 20 ? "UP" : "FLAT";
        const statusColor = status === "UP" ? "#00d26a" : status === "DOWN" ? "#ff4757" : "#ffa726";
        return {
          status, statusColor,
          current: { hi: nearHigh, lo: nearLow, nnh, pct50, pct200 },
          history: last3.map(h => ({
            date: h.date,
            hi: h.up_4pct || 0,
            lo: h.down_4pct || 0,
            nnh: (h.up_4pct || 0) - (h.down_4pct || 0),
            pct50: h.t2108 ? Math.round(h.t2108) : null,
            pct200: null,
          })),
          summary: `NNH ${nnh >= 0 ? 'positive' : 'negative'}. ${pct50}% above 50MA.`,
        };
      })(),
      portfolio,
      watchlist,
      liveGrouped,
      epCandidates,
      upcomingEarnings: (() => {
        if (!dashData?.stocks) return [];
        const byDate = {};
        dashData.stocks.forEach(s => {
          const disp = s.earnings_display;
          const days = s.earnings_days;
          if (!disp || !days || days < 0 || days > 10) return;
          const time = disp.includes('/a') ? 'a' : disp.includes('/b') ? 'b' : '';
          const dateStr = disp.replace(/\/[ab]$/, '').trim();
          const key = dateStr + '/' + time;
          if (!byDate[key]) byDate[key] = { date: dateStr, time, tickers: [] };
          byDate[key].tickers.push(s.ticker);
        });
        return Object.values(byDate)
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(0, 10)
          .map(d => ({ date: d.date, time: d.time, tickers: d.tickers.slice(0, 12) }));
      })(),
      futures: await (async () => {
        // Fetch futures/forex/crypto from FMP batch-quote
        try {
          const symbols = ["CLUSD","NGUSD","GCUSD","EURUSD","USDJPY","GBPUSD","BTCUSD"];
          const labels = { CLUSD:"Crude Oil", NGUSD:"Natural Gas", GCUSD:"Gold", EURUSD:"EUR/USD", USDJPY:"USD/JPY", GBPUSD:"GBP/USD", BTCUSD:"BTC/USD" };
          const url = `https://financialmodelingprep.com/stable/batch-quote?symbols=${symbols.join(",")}&apikey=${fmpKey}`;
          const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
          if (!r.ok) return [];
          const data = await r.json();
          const results = (Array.isArray(data) ? data : []).map(q => ({
            name: labels[q.symbol] || q.name || q.symbol,
            price: q.price ?? null,
            change: q.change ?? null,
            changePct: q.changePercentage ?? null,
          }));
          // Add index futures from existing quotes
          const idxMap = { SPY:"S&P 500", QQQ:"Nasdaq 100", DIA:"Dow", IWM:"Russell 2000" };
          for (const [sym, name] of Object.entries(idxMap)) {
            const q = quotes[sym];
            if (q) results.push({ name, price: q.price, change: q.change, changePct: q.changePercentage });
          }
          return results;
        } catch { return []; }
      })(),
    });

  } catch (err) {
    console.error("Market quality error:", err);
    return res.status(500).json({ error: err.message });
  }
}
