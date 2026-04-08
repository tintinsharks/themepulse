// ════════════════════════════════════════════════════════════════════════════
// api/analyze-ticker.js — On-demand 4-agent analysis for a single ticker
// ════════════════════════════════════════════════════════════════════════════
//
// User clicks "Analyze" on a ticker → POST here → returns a fully scored
// pick (Fundamentals/Technicals/Sentiment/Attention agents + catalyst).
//
// The frontend stores results in localStorage; this function does NOT
// persist anything server-side.
//
// Env vars:
//   FMP_API_KEY            (already set)
//   OPENROUTER_API_KEY     (needed for catalyst research)
// ════════════════════════════════════════════════════════════════════════════

export const config = { maxDuration: 30 };

const FMP = "https://financialmodelingprep.com/stable";

async function fmp(endpoint, params = "") {
  const sep = endpoint.includes("?") ? "&" : "?";
  const url = `${FMP}/${endpoint}${sep}${params}${
    params ? "&" : ""
  }apikey=${process.env.FMP_API_KEY}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// ── MAGNA scoring (0-4) — Massive earnings, Acceleration, Gap, Neglect ────
//
// Ported from compute_magna in 09r_rvol_catalyst_scan.py. A discrete 0-4
// quality score where each point is a presence-of-quality bonus.
//
// M: EPS or Sales growth >= 25% YoY
// A: Sales growth >= 40% (acceleration)
// G: Today's chg >= 4% (gap)
// N: Institutional ownership 0% < x < 40% (low / "neglected")
function computeMagna({ epsGrowth, salesGrowth, chgPct, instOwnPct }) {
  let score = 0;
  const details = [];
  const eps = Number(epsGrowth) || 0;
  const sales = Number(salesGrowth) || 0;
  const chg = Number(chgPct) || 0;
  const inst = Number(instOwnPct) || 0;
  if (eps >= 25 || sales >= 25) {
    score++;
    details.push(`M: EPS ${eps.toFixed(0)}%/Sales ${sales.toFixed(0)}%`);
  }
  if (sales >= 40) {
    score++;
    details.push(`A: Sales accel ${sales.toFixed(0)}%`);
  }
  if (chg >= 4) {
    score++;
    details.push(`G: Gap +${chg.toFixed(1)}%`);
  }
  if (inst > 0 && inst < 40) {
    score++;
    details.push(`N: Low inst ${inst.toFixed(0)}%`);
  }
  return { score, details };
}

// ── Directional weighted overall score ────────────────────────────────────
//
// Combines the 4 agents + MAGNA into a single 0-100 directional score
// where 0 = full bearish, 50 = neutral, 100 = full bullish.
//
//   For each agent: signedContribution = sigNumeric × (confidence/100) × weight
//     bullish=+1, neutral=0, bearish=-1
//   MAGNA: always non-negative (0..4 normalized to 0..1) since it's a
//     presence-of-quality score, not directional. Counted as bullish bias.
//
//   raw = (Σ agentContribs + magnaNorm × magnaWeight) / (Σ weights)
//   raw is in [-1, +1]
//   final = round((raw + 1) × 50) → 0..100
//
// Weights:
//   technicals  0.25   highest — price action is the most actionable signal
//   fundamentals 0.20
//   sentiment   0.20
//   attention   0.20
//   magna       0.15   discrete bonus for high-quality growth + setup
function directionalScore(agents, magnaScore) {
  const sigMap = { bullish: 1, neutral: 0, bearish: -1 };
  const weighted = [
    { agent: agents.fundamentals, weight: 0.17 },
    { agent: agents.technicals, weight: 0.22 },
    { agent: agents.sentiment, weight: 0.17 },
    { agent: agents.attention, weight: 0.17 },
    { agent: agents.subtheme, weight: 0.17 },
  ];
  const MAGNA_WEIGHT = 0.1;

  let agentSum = 0;
  let totalWeight = 0;
  for (const { agent, weight } of weighted) {
    if (!agent) continue;
    const sig = sigMap[agent.signal] ?? 0;
    const conf = (agent.confidence || 0) / 100;
    agentSum += sig * conf * weight;
    totalWeight += weight;
  }
  // MAGNA contributes a positive bias proportional to its 0-4 score
  const magnaNorm = Math.max(0, Math.min(4, magnaScore || 0)) / 4;
  agentSum += magnaNorm * MAGNA_WEIGHT;
  totalWeight += MAGNA_WEIGHT;

  const raw = totalWeight > 0 ? agentSum / totalWeight : 0;
  // Map [-1, +1] → [0, 100]
  const score = Math.round((raw + 1) * 50);
  return Math.max(0, Math.min(100, score));
}

// ── Fundamentals agent (port from score_fundamentals) ─────────────────────
function scoreFundamentals(metricsTtm, ratiosTtm, growth) {
  const m = metricsTtm || {};
  const r = ratiosTtm || {};
  const g = growth || {};
  // ROE lives on key-metrics-ttm. Margins live on ratios-ttm.
  const roe = m.returnOnEquityTTM ?? m.roeTTM ?? 0;
  const netMargin = r.netProfitMarginTTM ?? r.bottomLineProfitMarginTTM ?? 0;
  const opMargin = r.operatingProfitMarginTTM ?? r.ebitMarginTTM ?? 0;
  // Growth: prefer the latest annual revenueGrowth/epsgrowth fields,
  // fall back to 3-year per-share rates.
  const revG = g.revenueGrowth ?? g.threeYRevenueGrowthPerShare ?? 0;
  const epsG = g.epsgrowth ?? g.threeYNetIncomeGrowthPerShare ?? 0;

  const signals = [];
  const reasoning = {};

  // Profitability
  let p = 0;
  if (roe > 0.15) p++;
  if (netMargin > 0.2) p++;
  if (opMargin > 0.15) p++;
  const pSig = p >= 2 ? "bullish" : p === 0 ? "bearish" : "neutral";
  signals.push(pSig);
  reasoning.profitability = `${pSig} (ROE ${(roe * 100).toFixed(0)}%, NM ${(
    netMargin * 100
  ).toFixed(0)}%, OM ${(opMargin * 100).toFixed(0)}%)`;

  // Growth
  let gr = 0;
  if (revG > 0.1) gr++;
  if (epsG > 0.1) gr++;
  const gSig = gr >= 1 ? "bullish" : gr === 0 ? "bearish" : "neutral";
  signals.push(gSig);
  reasoning.growth = `${gSig} (Rev ${(revG * 100).toFixed(0)}%, EPS ${(
    epsG * 100
  ).toFixed(0)}%)`;

  // Health (proxy)
  let h = 0;
  if (roe > 0.1) h++;
  if (opMargin > 0.05) h++;
  const hSig = h >= 1 ? "bullish" : h === 0 ? "bearish" : "neutral";
  signals.push(hSig);
  reasoning.health = `${hSig} (proxy: ROE/OM)`;

  reasoning.valuation = "neutral (n/a)";
  signals.push("neutral");

  const bull = signals.filter((s) => s === "bullish").length;
  const bear = signals.filter((s) => s === "bearish").length;
  const overall = bull > bear ? "bullish" : bear > bull ? "bearish" : "neutral";
  const conf = Math.round((Math.max(bull, bear) / 4) * 100);
  return { signal: overall, confidence: conf, reasoning };
}

// ── Technicals agent (simplified — uses current price relative to 50/200) ─
async function scoreTechnicals(ticker) {
  // Pull a year of daily bars for a quick trend read
  const bars = await fmp(
    "historical-price-eod/full",
    `symbol=${ticker}&from=${
      new Date(Date.now() - 200 * 86400000).toISOString().split("T")[0]
    }`
  );
  if (!bars || !bars.length) {
    return {
      signal: "neutral",
      confidence: 0,
      reasoning: { trend: "no data" },
    };
  }
  const closes = bars
    .slice()
    .reverse()
    .map((b) => b.close)
    .filter(Boolean);
  if (closes.length < 50) {
    return {
      signal: "neutral",
      confidence: 0,
      reasoning: { trend: "insufficient history" },
    };
  }
  const last = closes[closes.length - 1];
  const sma20 =
    closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const sma50 =
    closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
  const sma200 =
    closes.length >= 200
      ? closes.slice(-200).reduce((a, b) => a + b, 0) / 200
      : null;
  // 1m / 3m / 6m returns
  const ret = (n) => {
    if (closes.length < n + 1) return 0;
    return ((last - closes[closes.length - 1 - n]) / closes[closes.length - 1 - n]) * 100;
  };
  const ret1m = ret(21);
  const ret3m = ret(63);
  const ret6m = ret(126);

  const sub = {};
  // Trend
  const aboveSma20 = last > sma20;
  const aboveSma50 = last > sma50;
  const aboveSma200 = sma200 ? last > sma200 : true;
  let trendSig = "neutral",
    trendConf = 0.5;
  if (aboveSma20 && aboveSma50 && aboveSma200) {
    trendSig = "bullish";
    trendConf = 0.9;
  } else if (!aboveSma20 && !aboveSma50) {
    trendSig = "bearish";
    trendConf = 0.7;
  }
  sub.trend = `${trendSig} (${trendConf.toFixed(2)})`;

  // Momentum
  const mom = 0.4 * ret1m + 0.3 * ret3m + 0.3 * ret6m;
  let momSig = "neutral",
    momConf = 0.5;
  if (mom > 5) {
    momSig = "bullish";
    momConf = Math.min(Math.abs(mom) / 30, 1);
  } else if (mom < -5) {
    momSig = "bearish";
    momConf = Math.min(Math.abs(mom) / 30, 1);
  }
  sub.momentum = `${momSig} (${momConf.toFixed(2)})`;
  sub.returns = `1m ${ret1m.toFixed(1)}%, 3m ${ret3m.toFixed(
    1
  )}%, 6m ${ret6m.toFixed(1)}%`;
  sub.smas = `Px ${last.toFixed(2)} vs 20 ${sma20.toFixed(
    1
  )} / 50 ${sma50.toFixed(1)}${sma200 ? ` / 200 ${sma200.toFixed(1)}` : ""}`;

  // Aggregate
  const sigs = [trendSig, momSig];
  const bull = sigs.filter((s) => s === "bullish").length;
  const bear = sigs.filter((s) => s === "bearish").length;
  const overall = bull > bear ? "bullish" : bear > bull ? "bearish" : "neutral";
  const conf = Math.round(((trendConf + momConf) / 2) * 100);
  return { signal: overall, confidence: conf, reasoning: sub };
}

// ── Sentiment agent (FMP insider trades + news) ───────────────────────────
async function scoreSentiment(ticker) {
  const insider = await fmp("insider-trading/search", `symbol=${ticker}&limit=50`);
  let bullI = 0,
    bearI = 0;
  if (Array.isArray(insider)) {
    for (const t of insider) {
      const shares =
        t.transactionShares || t.securitiesTransacted || 0;
      const ttype = (
        t.transactionType ||
        t.acquisitionOrDisposition ||
        ""
      ).toUpperCase();
      if (ttype.includes("S") || ttype.includes("DISPOS") || shares < 0) bearI++;
      else if (ttype.includes("P") || ttype.includes("ACQ") || shares > 0)
        bullI++;
    }
  }
  const news = await fmp("news/stock", `symbols=${ticker}&limit=30`);
  let bullN = 0,
    bearN = 0;
  if (Array.isArray(news)) {
    for (const n of news) {
      const text = ((n.title || "") + " " + (n.text || "")).toLowerCase();
      const pos = [
        "beat",
        "surge",
        "upgrade",
        "raise",
        "growth",
        "record",
        "strong",
        "approval",
        "wins",
        "expand",
      ].filter((w) => text.includes(w)).length;
      const neg = [
        "miss",
        "downgrade",
        "cut",
        "lawsuit",
        "fall",
        "drop",
        "weak",
        "decline",
        "loss",
        "investigation",
      ].filter((w) => text.includes(w)).length;
      if (pos > neg) bullN++;
      else if (neg > pos) bearN++;
    }
  }
  const bull = bullI * 0.3 + bullN * 0.7;
  const bear = bearI * 0.3 + bearN * 0.7;
  const total = bull + bear;
  if (total === 0) {
    return {
      signal: "neutral",
      confidence: 0,
      reasoning: { insider: "0/0", news: "0/0" },
    };
  }
  const overall = bull > bear ? "bullish" : bear > bull ? "bearish" : "neutral";
  const conf = Math.round((Math.max(bull, bear) / total) * 100);
  return {
    signal: overall,
    confidence: conf,
    reasoning: {
      insider: `${bullI}↑/${bearI}↓`,
      news: `${bullN}↑/${bearN}↓`,
    },
  };
}

// ── Attention agent (Stocktwits + News) ──────────────────────────────────
async function scoreAttention(ticker) {
  let stCount = 0,
    stBullPct = 50;
  try {
    const r = await fetch(
      `https://api.stocktwits.com/api/2/streams/symbol/${ticker}.json`,
      {
        headers: { "User-Agent": "themepulse/1.0" },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (r.ok) {
      const d = await r.json();
      const msgs = d.messages || [];
      stCount = msgs.length;
      let bull = 0,
        bear = 0;
      for (const m of msgs) {
        const sent = ((m.entities || {}).sentiment || {}).basic || "";
        if (sent === "Bullish") bull++;
        else if (sent === "Bearish") bear++;
      }
      const tot = bull + bear;
      stBullPct = tot ? Math.round((bull / tot) * 100) : 50;
    }
  } catch {
    /* ignore */
  }

  const news = await fmp("news/stock", `symbols=${ticker}&limit=50`);
  const cutoff = Date.now() - 24 * 3600 * 1000;
  const newsCount = Array.isArray(news)
    ? news.filter((n) => Date.parse(n.publishedDate || "") >= cutoff).length
    : 0;

  const stVolNorm = Math.min(stCount * 3, 100);
  const stSentNorm = stCount >= 5 ? stBullPct : 50;
  const newsNorm = Math.min(newsCount * 10, 100);

  const score = Math.round(
    0.5 * stVolNorm + 0.25 * stSentNorm + 0.25 * newsNorm
  );

  let signal = "neutral";
  if (score >= 50 && stBullPct >= 60 && stCount >= 5) signal = "bullish";
  else if (score >= 50 && stBullPct <= 40 && stCount >= 5) signal = "bearish";

  let tier = "NORMAL";
  if (score >= 70) tier = "EXTREME";
  else if (score >= 50) tier = "HIGH";
  else if (score >= 30) tier = "ELEVATED";

  return {
    signal,
    confidence: score,
    tier,
    reasoning: {
      stocktwits_msgs: `${stCount}/30`,
      stocktwits_bull: `${stBullPct}%`,
      news_articles: `${newsCount} in 24h`,
      tier,
    },
  };
}

// ── Subtheme agent — peer cohort analysis ────────────────────────────────
//
// Strong stocks in strong themes. We pull dashboard_data.json from the
// Vercel CDN (cached), locate the ticker's primary subtheme, then compute:
//   - peer count, median RS rank, % strong (rs_rank >= 80)
//   - mean 1-month return, top 5 leaders
//   - directional signal: bullish if median RS > 70 AND %strong >= 30%,
//     bearish if median RS < 40
// We also fire a Sonar query for narrative ("why is this subtheme moving,
// any institutional rotation").
async function scoreSubtheme(ticker) {
  let stocks = null;
  try {
    const r = await fetch(
      "https://themepulse.vercel.app/dashboard_data.json",
      { signal: AbortSignal.timeout(8000) }
    );
    if (r.ok) {
      const d = await r.json();
      stocks = d.stocks || [];
    }
  } catch {
    /* offline */
  }
  if (!stocks || !stocks.length) {
    return {
      signal: "neutral",
      confidence: 0,
      reasoning: { error: "dashboard_data unavailable" },
    };
  }
  const target = stocks.find((s) => s.ticker === ticker);
  const themes = (target && target.themes) || [];
  const subtheme = themes[0] && themes[0].subtheme;
  const theme = themes[0] && themes[0].theme;
  if (!subtheme) {
    return {
      signal: "neutral",
      confidence: 0,
      reasoning: { subtheme: "not classified" },
    };
  }
  const peers = stocks.filter(
    (s) =>
      s.ticker !== ticker &&
      Array.isArray(s.themes) &&
      s.themes.some((t) => t && t.subtheme === subtheme)
  );
  if (peers.length < 2) {
    return {
      signal: "neutral",
      confidence: 0,
      reasoning: { subtheme, peers: `${peers.length} (too few)` },
    };
  }
  const ranks = peers
    .map((p) => Number(p.rs_rank))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const medianRS = ranks.length
    ? ranks[Math.floor(ranks.length / 2)]
    : 0;
  const strongCount = ranks.filter((r) => r >= 80).length;
  const strongPct = ranks.length
    ? Math.round((strongCount / ranks.length) * 100)
    : 0;
  const rets = peers
    .map((p) => Number(p.return_1m))
    .filter((n) => Number.isFinite(n));
  const meanRet1m = rets.length
    ? rets.reduce((a, b) => a + b, 0) / rets.length
    : 0;
  const leaders = peers
    .filter((p) => Number.isFinite(Number(p.rs_rank)))
    .sort((a, b) => Number(b.rs_rank) - Number(a.rs_rank))
    .slice(0, 5)
    .map(
      (p) =>
        `${p.ticker}(RS${p.rs_rank}${
          Number.isFinite(Number(p.return_1m))
            ? `, ${Number(p.return_1m) >= 0 ? "+" : ""}${Number(
                p.return_1m
              ).toFixed(0)}%`
            : ""
        })`
    );

  // Narrative: why is this subtheme moving?
  let narrative = "";
  try {
    const tok = process.env.OPENROUTER_API_KEY;
    if (tok) {
      const today = new Date().toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      const peerNames = leaders.slice(0, 5).join(", ");
      const prompt = `Analyze the "${subtheme}" subtheme (parent theme: ${theme}) as of ${today}. Top stocks by relative strength: ${peerNames}. In 3-4 sentences: (1) what's driving this subtheme right now (catalysts, macro, sector rotation), (2) any visible institutional rotation INTO this subtheme (fund flows, smart money, notable buyers), (3) whether the leaders look like a coordinated group move or scattered. Plain prose, no markdown, no preamble.`;
      const r = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tok}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://themepulse.vercel.app",
            "X-Title": "ThemePulse Subtheme",
          },
          body: JSON.stringify({
            model: "perplexity/sonar",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 350,
            temperature: 0.3,
          }),
          signal: AbortSignal.timeout(20000),
        }
      );
      if (r.ok) {
        const d = await r.json();
        narrative = (
          ((d.choices || [])[0] || {}).message?.content || ""
        )
          .replace(/\[\d+\]/g, "")
          .replace(/\s+/g, " ")
          .trim();
      }
    }
  } catch {
    /* ignore */
  }

  // Score
  let signal = "neutral";
  let conf = 50;
  if (medianRS >= 70 && strongPct >= 30) {
    signal = "bullish";
    conf = Math.min(60 + strongPct / 2, 95);
  } else if (medianRS < 40) {
    signal = "bearish";
    conf = Math.min(60 + (40 - medianRS), 90);
  } else {
    conf = 40 + Math.round(medianRS / 5);
  }

  return {
    signal,
    confidence: Math.round(conf),
    reasoning: {
      subtheme: `${subtheme} (${theme})`,
      peers: `${peers.length} stocks`,
      median_rs: `${medianRS}`,
      strong: `${strongCount}/${ranks.length} ≥ RS80 (${strongPct}%)`,
      mean_1m: `${meanRet1m >= 0 ? "+" : ""}${meanRet1m.toFixed(1)}%`,
      leaders: leaders.join(", ") || "none",
      narrative: narrative || "n/a",
    },
  };
}

// ── Catalyst research via OpenRouter Perplexity Sonar ─────────────────────
async function researchCatalyst(ticker, chg) {
  const tok = process.env.OPENROUTER_API_KEY;
  if (!tok) return "";
  const today = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const prompt = `Why is ${ticker} stock moving ${
    chg >= 0 ? "+" : ""
  }${(chg || 0).toFixed(
    1
  )}% today (${today})? Write a 3-4 sentence catalyst paragraph covering: (1) the specific news/event/earnings driving the move, (2) broader context (sector, prior catalysts, analyst actions), (3) what to watch next. Plain text only — no emoji, no markdown, no preamble. Just the paragraph.`;
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tok}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://themepulse.vercel.app",
        "X-Title": "ThemePulse Analyze",
      },
      body: JSON.stringify({
        model: "perplexity/sonar",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 350,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return "";
    const d = await r.json();
    let text = (
      ((d.choices || [])[0] || {}).message?.content || ""
    ).trim();
    text = text.replace(/\[\d+\]/g, "").replace(/\s+/g, " ").trim();
    return text;
  } catch (e) {
    return "";
  }
}

// ── Main handler ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "POST only" });
  }

  const body = req.body || {};
  const ticker = (body.ticker || "").toString().trim().toUpperCase();
  if (!ticker) {
    return res.status(400).json({ ok: false, error: "Missing ticker" });
  }

  try {
    // Live quote (FMP batch-quote)
    const quote = await fmp("batch-quote", `symbols=${ticker}`);
    const q = Array.isArray(quote) && quote[0] ? quote[0] : {};
    if (!q.price) {
      return res.status(404).json({ ok: false, error: `No data for ${ticker}` });
    }

    // Profile + TTM ratios + TTM key metrics + growth (latest annual)
    // ratios-ttm has the margin fields; key-metrics-ttm has ROE.
    const [profile, ratiosTtm, metricsTtm, growth] = await Promise.all([
      fmp("profile", `symbol=${ticker}`),
      fmp("ratios-ttm", `symbol=${ticker}`),
      fmp("key-metrics-ttm", `symbol=${ticker}`),
      fmp("financial-growth", `symbol=${ticker}&period=annual&limit=1`),
    ]);
    const prof = (profile && profile[0]) || {};
    const r0 = (ratiosTtm && ratiosTtm[0]) || {};
    const m0 = (metricsTtm && metricsTtm[0]) || {};
    const g0 = (growth && growth[0]) || {};

    // 5 agents + catalyst in parallel
    const [funds, tech, sent, attn, sub, catalyst] = await Promise.all([
      Promise.resolve(scoreFundamentals(m0, r0, g0)),
      scoreTechnicals(ticker),
      scoreSentiment(ticker),
      scoreAttention(ticker),
      scoreSubtheme(ticker),
      researchCatalyst(ticker, q.changePercentage),
    ]);

    // MAGNA — uses growth + chg from FMP data we already have. Inst ownership
    // is left at 0 (would need an extra /institutional-ownership call); the
    // 'N' bonus point will fire if the user wires that up later.
    const magna = computeMagna({
      epsGrowth: ((g0 && g0.epsgrowth) || 0) * 100,
      salesGrowth: ((g0 && g0.revenueGrowth) || 0) * 100,
      chgPct: q.changePercentage || 0,
      instOwnPct: 0,
    });

    // Aggregate overall (signed bull/bear majority across the 4 agents)
    const sigs = [funds.signal, tech.signal, sent.signal, attn.signal, sub.signal];
    const bull = sigs.filter((s) => s === "bullish").length;
    const bear = sigs.filter((s) => s === "bearish").length;
    const overall =
      bull > bear ? "bullish" : bear > bull ? "bearish" : "neutral";
    const avgConf = Math.round(
      (funds.confidence +
        tech.confidence +
        sent.confidence +
        attn.confidence +
        sub.confidence) /
        5
    );

    // Directional weighted 0-100 score (50 = neutral)
    const score = directionalScore(
      {
        fundamentals: funds,
        technicals: tech,
        sentiment: sent,
        attention: attn,
        subtheme: sub,
      },
      magna.score
    );

    const pick = {
      ticker,
      analyzed_at: new Date().toISOString(),
      company: prof.companyName || prof.symbol || ticker,
      sector: prof.sector || "",
      industry: prof.industry || "",
      price: q.price,
      chg: q.changePercentage || 0,
      open: q.open || null,
      high: q.dayHigh || null,
      low: q.dayLow || null,
      volume: q.volume || 0,
      market_cap: q.marketCap || null,
      score,
      magna_score: magna.score,
      magna_details: magna.details,
      reasoning: `Chg ${(q.changePercentage || 0).toFixed(
        1
      )}% | M${magna.score}/4 | ${prof.industry || ""}`,
      catalyst: catalyst || null,
      source: "ANALYZED",
      agents: {
        overall,
        confidence: avgConf,
        fundamentals: funds,
        technicals: tech,
        sentiment: sent,
        attention: attn,
        subtheme: sub,
      },
    };

    return res.status(200).json({ ok: true, pick });
  } catch (err) {
    console.error("analyze-ticker error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
