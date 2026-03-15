// Vercel serverless function: POST /api/tqqq-analyze
// Sends trade details + strategy analysis to Claude for actionable recommendations

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

  const { trade, strategies, currentPrice, adr, date } = req.body || {};
  if (!trade?.entryPrice) return res.status(400).json({ ok: false, error: "Missing trade data" });

  const dir = trade.direction || "long";
  const entry = parseFloat(trade.entryPrice);
  const current = parseFloat(currentPrice) || entry;
  const pnlPct = dir === "long" ? ((current - entry) / entry * 100) : ((entry - current) / entry * 100);
  const daysHeld = trade.daysHeld || 0;

  // Build strategy summary for the prompt
  let stratSummary = "";
  if (strategies && strategies.length > 0) {
    stratSummary = strategies.map(s =>
      `${s.label}: ${s.rec} | Stop $${s.stop} (${s.stopPct}%) | Target $${s.target} (${s.targetPct}%) | Hold ${s.daysHeld}/${s.maxHold}d | Flags: ${s.flags || "none"}`
    ).join("\n");
  }

  const systemPrompt = `You are a TQQQ swing trading advisor. The user has an active or closed TQQQ trade. You have 4 backtested strategy analyses to reference.

Strategy context:
- v5: Aggressive (long+short), wider stops, shorter holds. Best for momentum.
- v5.2: v5 + time-decay stop (tightens after day 5) + conditional hold extension (+2 days if profitable).
- v6: Conservative (long-only), tighter stops, drawdown reduction. Best risk-adjusted.
- v6.2: v6 + same engine tweaks as v5.2.

Rules:
- Be direct and actionable. No disclaimers or "not financial advice".
- Reference specific strategy levels (stop, target) when relevant.
- If strategies disagree, explain why and give your weighted recommendation.
- Keep total output under 150 words.
- Use plain language, no markdown headers. Just 2-3 short paragraphs.
- First paragraph: overall verdict (hold/exit/tighten stop). Bold the key action.
- Second paragraph: key levels to watch and what would change your mind.
- If the trade is closed, analyze what went right/wrong vs the strategies.`;

  const userMsg = `TQQQ Trade:
- Direction: ${dir.toUpperCase()}
- Entry: $${entry}${trade.entryDate ? ` on ${trade.entryDate}` : ""}
- Current: $${current} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)
- Days held: ${daysHeld}
- ADR: $${adr || "N/A"}
- Date: ${date || "today"}
- Status: ${trade.mode || "open"}

Strategy Analysis:
${stratSummary || "No strategy data available"}

What should I do?`;

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
    for (const block of data.content || []) {
      if (block.type === "text") analysis += block.text;
    }

    return res.json({ ok: true, analysis: analysis.trim() });
  } catch (e) {
    if (e.name === "AbortError") {
      return res.status(504).json({ ok: false, error: "Request timed out" });
    }
    return res.status(500).json({ ok: false, error: e.message });
  }
}
