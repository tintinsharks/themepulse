// Vercel serverless function: /api/catalyst-summary?ticker=BOX&company=Box%20Inc&change=6.35&source=per&headlines=...
// Calls Anthropic API with web search to generate 2-line catalyst summary

const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { ticker, company, change, source, headlines, eps_beat, rev_beat, eps_growth, rev_growth,
    market_cap, inst_own, gap_pct, volume, rev_prev_q, eps_raw, eps_prev_raw, rev_raw, ipo_date, shares_float } = req.query;
  if (!ticker) return res.status(400).json({ ok: false, error: "Missing ticker" });

  // Check cache
  const cacheKey = `${ticker}_${source}_${change}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return res.json(cached.data);
  }

  const sourceLabel = source === "per" ? "pre-market after reporting earnings"
    : source === "aer" ? "after-hours after reporting earnings"
    : source === "pm" ? "in pre-market trading"
    : source === "ah" ? "in after-hours trading"
    : "today";

  const chgNum = parseFloat(change) || 0;
  const direction = chgNum >= 0 ? "up" : "down";

  const today = new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", timeZone: "America/New_York" });

  const systemPrompt = `You are a financial analyst writing catalyst notes for a stock screener dashboard. Use web search to find the latest news. Write in this exact format:

{TICKER} {MM/DD} — {What happened: the catalyst, specific numbers, who upgraded/downgraded, earnings beat/miss details}. Why: {Why it matters — industry context, narrative, supply chain, competitive positioning, or thematic tailwind that explains the move}.

Example: ALM 03/03 — Up 53% on a 9-day winning streak, B. Riley upgrade to $17. Why: Tungsten is a critical mineral for defense and semiconductors with a China-dominated supply chain — ALM's Sangdong mine in South Korea is a rare Western-aligned source, and the strategic minerals narrative is red hot.

Rules:
- One continuous line, no line breaks
- Be specific with numbers (EPS, revenue, price targets, % beats)
- The "Why" should explain the narrative/theme driving the move, not just restate the catalyst
- No disclaimers, no hedging, no preamble — start DIRECTLY with the ticker symbol, never with "Based on..." or "Let me..."
- Today's date is ${today}

After the catalyst note, on a NEW line, output MAGNA tags and SIP type.

MAGNA53Cap10*10 — tag ONLY initials that are clearly met:
- MA: Massive accel — EPS growth ≥100% YoY on meaningful base (not 1¢→4¢, need $0.05+ base) OR sales growth ≥100% OR 2+ consecutive Qs of sales growth ≥25% on $25M+ annual revenue
- G: Gap ≥4% on earnings/news day with ≥100K volume
- N: Neglected — inst ownership <30%, basing months/years, low analyst coverage
- A: Sales acceleration ≥25% YoY (earnings growth without sales growth is suspect unless turnaround)
- 5: Short interest >5 days to cover (use web search)
- 3: 3+ recent analyst upgrades/price target raises (use web search)
- Cap10: Market cap <$10B
- *10: <10 years since IPO (use web search if IPO date not provided)

SIP Classification:
- ER: Earnings-driven move
- News: Unscheduled company/industry/macro news
- Biotech: Low float/low price explosive mover
- ShortSq: High short interest >10 days with catalyst
- Theme: Current market theme play (AI, defense, crypto, etc.)

Context notes:
- Big run BEFORE catalyst day = reduced chance of sustained move
- Early-season earnings reporters have bigger moves; late reporters who ran in sympathy have muted reactions
- Gap downs = choppy; gap ups = better follow-through (though 60-70% fail)
- Unscheduled news has more short-term impact than scheduled earnings
- High short interest (>10 days) + decent news = short squeeze candidate, usually 1-day move

Format last line as: [MA G A Cap10] ER
Only include tags that are MET. Brackets for MAGNA tags, then space, then SIP type.`;

  let userMsg = `${ticker}${company ? ` (${company})` : ""} is ${direction} ${Math.abs(chgNum).toFixed(1)}% ${sourceLabel}.`;
  if (headlines) userMsg += `\nScraped headlines: ${headlines.replace(/\|/g, "; ")}`;
  if (eps_beat === "true") userMsg += "\nEPS beat estimates.";
  if (eps_beat === "false") userMsg += "\nEPS missed estimates.";
  if (rev_beat === "true") userMsg += " Revenue beat estimates.";
  if (rev_beat === "false") userMsg += " Revenue missed estimates.";
  if (eps_growth) userMsg += ` EPS growth YoY: ${eps_growth}%.`;
  if (rev_growth) userMsg += ` Revenue growth YoY: ${rev_growth}%.`;
  // MAGNA tag data
  if (market_cap) userMsg += `\nMarket cap: $${(parseFloat(market_cap) / 1e9).toFixed(2)}B.`;
  if (inst_own) userMsg += ` Inst ownership: ${inst_own}%.`;
  if (gap_pct) userMsg += ` Gap/change: ${gap_pct}%.`;
  if (volume) userMsg += ` Volume: ${parseInt(volume).toLocaleString()}.`;
  if (rev_prev_q) userMsg += ` Prior Q revenue growth YoY: ${rev_prev_q}%.`;
  if (eps_raw) userMsg += ` Latest Q EPS: $${eps_raw}.`;
  if (eps_prev_raw) userMsg += ` Prior Q EPS: $${eps_prev_raw}.`;
  if (rev_raw) userMsg += ` Latest Q revenue: $${rev_raw}.`;
  if (ipo_date) userMsg += ` IPO date: ${ipo_date}.`;
  if (shares_float) userMsg += ` Float: ${(parseFloat(shares_float) / 1e6).toFixed(1)}M shares.`;
  userMsg += `\n\nWrite a catalyst note in the specified format, then MAGNA tags + SIP type on a new line. Today is ${today}.`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        tools: [{
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 2,
          user_location: { type: "approximate", country: "US", timezone: "America/New_York" },
        }],
        system: systemPrompt,
        messages: [{ role: "user", content: userMsg }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Anthropic API ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const data = await resp.json();

    // Extract text from response content blocks
    let summary = "";
    const sources = [];

    for (const block of data.content || []) {
      if (block.type === "text") {
        summary += block.text;
        // Extract citations if present
        if (block.citations) {
          for (const cite of block.citations) {
            if (cite.url && !sources.find(s => s.url === cite.url)) {
              sources.push({ url: cite.url, title: cite.title || cite.url });
            }
          }
        }
      }
    }

    summary = summary.trim();
    if (!summary) throw new Error("Empty response from API");

    const result = { ok: true, summary, sources };
    cache.set(cacheKey, { ts: Date.now(), data: result });

    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");
    return res.json(result);
  } catch (e) {
    if (e.name === "AbortError") {
      return res.status(504).json({ ok: false, error: "Request timed out" });
    }
    return res.status(500).json({ ok: false, error: e.message });
  }
}
