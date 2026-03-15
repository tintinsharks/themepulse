// Vercel serverless function: POST /api/tqqq-analyze
// Sends trade details + strategy analysis to Claude for actionable recommendations

// Hardcoded strategy parameters from backtested models
const STRATEGY_PARAMS = {
  v5: { label: "v5 (Aggressive)", adr_stop: 2.5, adr_target: 4.0, max_hold: 7, trail_mult: 2.0, be_trigger: 2.0, be_trail: 2.5, ema8w_exit: "strict", time_decay_start: 0, extend_if_profit: 0, description: "Long+short, wider stops, shorter holds. 146t | 49% WR | 7.8% CAGR | -53% MDD" },
  "v5.2": { label: "v5.2 (Aggressive+Tweaks)", adr_stop: 2.5, adr_target: 4.0, max_hold: 7, trail_mult: 2.0, be_trigger: 2.0, be_trail: 2.5, ema8w_exit: "strict", time_decay_start: 5, time_decay_rate: 0.5, extend_if_profit: 2, description: "v5 + time-decay stop after day 5 + extend hold +2d if profitable. 111t | 54% WR | 40% CAGR | -31% MDD" },
  v6: { label: "v6 (Risk-Adjusted)", adr_stop: 2.25, adr_target: 5.0, max_hold: 7, trail_mult: 3.0, be_trigger: 2.0, be_trail: 2.5, ema8w_exit: "strict", dd_reduce: 8, gap_filter: 4.0, time_decay_start: 0, extend_if_profit: 0, description: "Long-only, tighter stops, DD reduction, gap filter. 94t | 67% WR | 25.5% CAGR | -12.8% MDD | Best risk-adjusted" },
  "v6.2": { label: "v6.2 (Risk-Adjusted+Tweaks)", adr_stop: 2.25, adr_target: 5.0, max_hold: 7, trail_mult: 3.0, be_trigger: 2.0, be_trail: 2.5, ema8w_exit: "strict", dd_reduce: 8, gap_filter: 4.0, time_decay_start: 5, time_decay_rate: 0.5, extend_if_profit: 2, description: "v6 + time-decay stop + conditional hold. 90t | 64% WR | 25.7% CAGR | -15.1% MDD" },
};

function computeLevels(entry, adr, daysHeld, currentPrice, dir, params) {
  const isLong = dir === "long";
  let stop = isLong ? entry - params.adr_stop * adr : entry + params.adr_stop * adr;
  const target = isLong ? entry + params.adr_target * adr : entry - params.adr_target * adr;

  // Ratcheting breakeven
  let ratchet = false;
  if (params.be_trigger > 0) {
    const best = isLong ? Math.max(entry, currentPrice) : Math.min(entry, currentPrice);
    const profitAdr = Math.abs(best - entry) / adr;
    if (profitAdr >= params.be_trigger) {
      ratchet = true;
      if (isLong) stop = Math.max(stop, Math.max(entry, best - params.be_trail * adr));
      else stop = Math.min(stop, Math.min(entry, best + params.be_trail * adr));
    }
  }

  // Time-decay stop
  let decay = false;
  if (params.time_decay_start > 0 && daysHeld >= params.time_decay_start) {
    decay = true;
    const daysPast = daysHeld - params.time_decay_start;
    const rate = params.time_decay_rate || 0.5;
    if (isLong) stop = Math.max(stop, stop + daysPast * rate * adr);
    else stop = Math.min(stop, stop - daysPast * rate * adr);
  }

  // Max hold
  const profitable = isLong ? currentPrice > entry : currentPrice < entry;
  const maxHold = params.max_hold + (params.extend_if_profit > 0 && profitable ? params.extend_if_profit : 0);
  const stopHit = isLong ? currentPrice <= stop : currentPrice >= stop;
  const targetHit = isLong ? currentPrice >= target : currentPrice <= target;
  const maxHoldReached = daysHeld >= maxHold;

  let rec;
  if (targetHit) rec = "TARGET HIT — Take profit";
  else if (stopHit) rec = "STOP HIT — Exit now";
  else if (maxHoldReached) rec = "MAX HOLD — Time to exit";
  else if (decay) rec = `HOLD — Stop tightening (decay day ${daysHeld})`;
  else rec = `HOLD — ${Math.max(0, maxHold - daysHeld)}d remaining`;

  return { stop: stop.toFixed(2), target: target.toFixed(2), stopPct: ((stop - entry) / entry * 100).toFixed(1), targetPct: ((target - entry) / entry * 100).toFixed(1), maxHold, daysHeld, ratchet, decay, stopHit, targetHit, maxHoldReached, rec };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

  const { trade, strategies, currentPrice, adr, date, priorAnalyses } = req.body || {};
  if (!trade?.entryPrice) return res.status(400).json({ ok: false, error: "Missing trade data" });

  const dir = trade.direction || "long";
  const entry = parseFloat(trade.entryPrice);
  const current = parseFloat(currentPrice) || entry;
  const adrVal = parseFloat(adr) || 0;
  const userStop = trade.stopPrice ? parseFloat(trade.stopPrice) : null;
  const pnlPct = dir === "long" ? ((current - entry) / entry * 100) : ((entry - current) / entry * 100);
  const daysHeld = trade.daysHeld || 0;

  // Use client-sent strategies if available, otherwise compute from hardcoded params
  let stratSummary;
  if (strategies && strategies.length > 0) {
    stratSummary = strategies.map(s =>
      `${s.label}: ${s.rec} | Stop $${s.stop} (${s.stopPct}%) | Target $${s.target} (${s.targetPct}%) | Hold ${s.daysHeld}/${s.maxHold}d | Flags: ${s.flags || "none"}`
    ).join("\n");
  } else if (adrVal > 0) {
    // Compute levels server-side from hardcoded params
    stratSummary = Object.entries(STRATEGY_PARAMS).map(([key, params]) => {
      if (dir !== "long" && (key === "v6" || key === "v6.2")) return `${params.label}: N/A (long-only strategy)`;
      const lvl = computeLevels(entry, adrVal, daysHeld, current, dir, params);
      return `${params.label}: ${lvl.rec} | Stop $${lvl.stop} (${lvl.stopPct}%) | Target $${lvl.target} (${lvl.targetPct}%) | Hold ${daysHeld}/${lvl.maxHold}d | Flags: ${[lvl.ratchet && "RATCHET", lvl.decay && "DECAY", lvl.stopHit && "STOP HIT", lvl.targetHit && "TARGET HIT", lvl.maxHoldReached && "MAX HOLD"].filter(Boolean).join(", ") || "none"}`;
    }).join("\n");
  } else {
    stratSummary = Object.entries(STRATEGY_PARAMS).map(([, p]) => `${p.label}: ${p.description}`).join("\n");
  }

  const systemPrompt = `You are a TQQQ swing trading advisor. The user has an active or closed TQQQ trade. You have 4 backtested strategy models with computed stop/target levels.

Strategy backtest context:
- v5: Aggressive (long+short), wider stops (2.5 ADR), shorter holds (7d). Backtest: 146t, 49% WR, -53% MDD.
- v5.2: v5 + time-decay stop (tightens 0.5 ADR/day after day 5) + extend hold +2d if profitable. Backtest: 111t, 54% WR, -31% MDD.
- v6: Conservative (long-only), tighter stops (2.25 ADR), wider targets (5 ADR), DD reduction at -8%, gap filter. Backtest: 94t, 67% WR, -12.8% MDD. Best risk-adjusted (champion).
- v6.2: v6 + time-decay + conditional hold. Backtest: 90t, 64% WR, -15.1% MDD.

ADR = Average Daily Range in dollars. Stops and targets are multiples of ADR from entry.
Ratcheting breakeven: after 2 ADR profit, stop moves to max(entry, best - 2.5*ADR).
Time-decay: after day 5, stop tightens by 0.5*ADR per additional day held.

CRITICAL — Stop/target direction rules:
- LONG trade: stop is BELOW entry, target is ABOVE entry. A LOWER stop = MORE risk (wider). A HIGHER stop = LESS risk (tighter).
- SHORT trade: stop is ABOVE entry, target is BELOW entry. A HIGHER stop = MORE risk (wider). A LOWER stop = LESS risk (tighter).
- When comparing the user's stop to strategy stops: "tighter" means LESS dollar risk from entry, "wider" means MORE dollar risk from entry.
- Example: SHORT at $46.80 — user stop $49.78 ($2.98 risk) vs model stop $52.67 ($5.87 risk) → user's stop is TIGHTER (less risk, closer to entry).
- Always compute the dollar distance from entry to stop when comparing: |stop - entry|. Smaller distance = tighter stop.

Your output MUST have exactly TWO sections separated by "---" on its own line:

SECTION 1 — MODEL ANALYSIS (based on backtested strategies):
- Be direct and actionable. No disclaimers.
- Reference the SPECIFIC dollar levels from the strategy analysis below.
- If strategies disagree, explain why and give your weighted recommendation (v6 is the champion, weight it highest).
- If the user has set a manual stop, compare it to the strategy stops by computing |stop - entry| for both. State which is tighter/wider and by how much.
- First paragraph: overall verdict (hold/exit/tighten stop). Bold the key action.
- Second paragraph: key levels to watch and what would change your mind.
- Keep to ~100 words.

SECTION 2 — TRADE CRAFT ANALYSIS (ignore the models entirely):
- Analyze purely from swing trading best practices: risk/reward ratio, position in trend, TQQQ characteristics (3x leveraged = decays in choppy markets, best for strong trends), market context.
- For LONG trades: assess trend strength, support levels, whether entry was at a proper buy point (breakout, pullback to support, follow-through day).
- For SHORT trades: assess whether shorting a 3x bull ETF is appropriate (fighting long-term uptrend), catalyst quality, overhead resistance, whether this is a counter-trend or trend-following short.
- Comment on trade management: is the stop logical (below support/above resistance?), is the R:R ratio adequate (minimum 2:1?), is the position size appropriate for a leveraged ETF?
- Be honest — if the trade setup is questionable, say so.
- Keep to ~100 words.

General rules for BOTH sections:
- If the trade is closed, analyze what went right/wrong.
- If prior analyses are provided, this is a RUNNING JOURNAL. Reference how the situation has evolved. Be brief about what hasn't changed.
- No markdown headers — just flowing paragraphs. The "---" separator is the only structural element.`;

  // Build prior analysis journal
  let journalSection = "";
  if (priorAnalyses && priorAnalyses.length > 0) {
    journalSection = "\n\nPrior Analysis Journal (most recent last):\n" + priorAnalyses.map(p =>
      `[${p.date}] Price $${p.price} (${p.pnlPct}%) Day ${p.daysHeld}: ${p.analysis.slice(0, 200)}`
    ).join("\n");
  }

  const userStopRisk = userStop ? Math.abs(userStop - entry) : null;
  const userStopRiskPct = userStopRisk ? (userStopRisk / entry * 100) : null;
  const userStopAdr = userStopRisk && adrVal > 0 ? (userStopRisk / adrVal) : null;

  const userMsg = `TQQQ Trade:
- Direction: ${dir.toUpperCase()}
- Entry: $${entry}${trade.entryDate ? ` on ${trade.entryDate}` : ""}
- Current: $${current} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)
- Days held: ${daysHeld}
- My stop: ${userStop ? `$${userStop} (risk: $${userStopRisk.toFixed(2)} = ${userStopRiskPct.toFixed(1)}% = ${userStopAdr ? userStopAdr.toFixed(2) + " ADR" : "N/A"})` : "not set"}
- ADR: $${adrVal > 0 ? adrVal.toFixed(2) : "N/A"}
- Date: ${date || "today"}
- Status: ${trade.mode || "open"}

Strategy Analysis (computed from backtested models):
${stratSummary}${journalSection}

What should I do with this trade?`;

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
        max_tokens: 600,
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
