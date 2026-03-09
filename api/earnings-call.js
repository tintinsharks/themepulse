// Vercel serverless function: /api/earnings-call?ticker=AAPL&company=Apple%20Inc
// Calls Anthropic API with web search to analyze the most recent earnings call

const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { ticker, company, quarters } = req.query;
  if (!ticker) return res.status(400).json({ ok: false, error: "Missing ticker" });

  const cacheKey = `ec_${ticker}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return res.json(cached.data);
  }

  const today = new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric", timeZone: "America/New_York" });

  const systemPrompt = `You are an expert stock analyst writing earnings call summaries for growth stock traders (O'Neil/Minervini style). Use web search to find the most recent earnings call transcript or recap for the given ticker. Today is ${today}.

Output format — use EXACTLY these sections with markdown headers:

## Key Numbers
- Revenue: $X (+Y% YoY) — beat/miss by Z%
- EPS: $X (+Y% YoY) — beat/miss by Z%
- Guidance: raised/maintained/lowered — next Q rev $X, EPS $X

## Management Tone
1-2 sentences on CEO/CFO confidence, language shifts, key quotes if notable.

## Growth Catalysts
- Bullet each major catalyst discussed (new products, TAM expansion, pricing, bookings, backlog, partnerships)
- Include specific numbers/metrics

## Risks & Concerns
- Bullet any negatives (margin pressure, customer concentration, macro headwinds, deceleration)

## Trader Takeaway
1-2 sentences: Is this a buy-the-dip, breakout, or avoid? Focus on what matters for a growth stock trader.

Rules:
- Be specific with numbers. No vague statements.
- Keep total output under 300 words.
- If you cannot find the earnings call, say so clearly in 1 line.
- ABSOLUTELY ZERO meta-commentary or narration about your search process. No "I'll search", "I need to search", "Let me analyze", "Based on my search", "I found", "Looking at". Your output must start IMMEDIATELY with "## Key Numbers". If your first line is not "## Key Numbers", you have failed.`;

  const userMsg = `Analyze the most recent earnings call for ${ticker}${company ? ` (${company})` : ""}.${quarters ? `\nRecent quarterly data from our pipeline: ${quarters}` : ""}\n\nSearch for the latest earnings call transcript/recap and provide analysis.`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1000,
        tools: [{
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 3,
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

    let analysis = "";
    const sources = [];

    for (const block of data.content || []) {
      if (block.type === "text") {
        analysis += block.text;
        if (block.citations) {
          for (const cite of block.citations) {
            if (cite.url && !sources.find(s => s.url === cite.url)) {
              sources.push({ url: cite.url, title: cite.title || cite.url });
            }
          }
        }
      }
    }

    analysis = analysis.trim();
    // Strip meta-commentary lines before the actual analysis
    const metaRe = /^(I('ll| will| need to| found| can)|\blet me\b|\bbased on\b|\blooking at\b|\bafter search\b|\bfrom the search\b|\bthe search\b|\bsearching\b|\bunfortunately\b|\bhowever\b)/i;
    const lines = analysis.split("\n");
    const firstSection = lines.findIndex(l => l.startsWith("## "));
    if (firstSection > 0) {
      analysis = lines.slice(firstSection).join("\n");
    } else {
      analysis = lines.filter(l => !metaRe.test(l.trim())).join("\n").trim();
    }
    if (!analysis) throw new Error("Empty response from API");

    const result = { ok: true, analysis, sources };
    cache.set(cacheKey, { ts: Date.now(), data: result });

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=7200");
    return res.json(result);
  } catch (e) {
    if (e.name === "AbortError") {
      return res.status(504).json({ ok: false, error: "Request timed out" });
    }
    return res.status(500).json({ ok: false, error: e.message });
  }
}
