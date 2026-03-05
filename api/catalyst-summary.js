// Vercel serverless function: /api/catalyst-summary?ticker=BOX&company=Box%20Inc&change=6.35&source=per&headlines=...
// Calls Anthropic API with web search to generate 2-line catalyst summary

const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { ticker, company, change, source, headlines, eps_beat, rev_beat, eps_growth, rev_growth } = req.query;
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
- No disclaimers, no hedging
- Today's date is ${today}`;

  let userMsg = `${ticker}${company ? ` (${company})` : ""} is ${direction} ${Math.abs(chgNum).toFixed(1)}% ${sourceLabel}.`;
  if (headlines) userMsg += `\nScraped headlines: ${headlines.replace(/\|/g, "; ")}`;
  if (eps_beat === "true") userMsg += "\nEPS beat estimates.";
  if (eps_beat === "false") userMsg += "\nEPS missed estimates.";
  if (rev_beat === "true") userMsg += " Revenue beat estimates.";
  if (rev_beat === "false") userMsg += " Revenue missed estimates.";
  if (eps_growth) userMsg += ` EPS growth YoY: ${eps_growth}%.`;
  if (rev_growth) userMsg += ` Revenue growth YoY: ${rev_growth}%.`;
  userMsg += `\n\nWrite a catalyst note in the specified format. Today is ${today}.`;

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
        max_tokens: 300,
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
