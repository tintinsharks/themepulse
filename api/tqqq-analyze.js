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

  let decay = false;
  if (params.time_decay_start > 0 && daysHeld >= params.time_decay_start) {
    decay = true;
    const daysPast = daysHeld - params.time_decay_start;
    const rate = params.time_decay_rate || 0.5;
    if (isLong) stop = Math.max(stop, stop + daysPast * rate * adr);
    else stop = Math.min(stop, stop - daysPast * rate * adr);
  }

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

  const stopRisk = Math.abs(stop - entry);
  const stopRiskPct = (stopRisk / entry * 100);
  const stopRiskAdr = adr > 0 ? stopRisk / adr : 0;

  return { stop: stop.toFixed(2), target: target.toFixed(2), stopRisk: stopRisk.toFixed(2), stopRiskPct: stopRiskPct.toFixed(1), stopRiskAdr: stopRiskAdr.toFixed(2), targetPct: ((Math.abs(target - entry)) / entry * 100).toFixed(1), maxHold, daysHeld, ratchet, decay, stopHit, targetHit, maxHoldReached, rec };
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

  // Pre-compute user stop risk
  const userStopRisk = userStop ? Math.abs(userStop - entry) : null;
  const userStopRiskPct = userStopRisk ? (userStopRisk / entry * 100) : null;
  const userStopAdr = userStopRisk && adrVal > 0 ? (userStopRisk / adrVal) : null;

  // Build strategy summary with explicit risk comparisons
  let stratSummary;
  const stratLines = [];

  if (strategies && strategies.length > 0) {
    for (const s of strategies) {
      const modelStopRisk = Math.abs(parseFloat(s.stop) - entry);
      let comparison = "";
      if (userStopRisk !== null) {
        if (userStopRisk < modelStopRisk) {
          comparison = ` ← USER STOP IS TIGHTER ($${userStopRisk.toFixed(2)} risk vs model $${modelStopRisk.toFixed(2)} risk)`;
        } else if (userStopRisk > modelStopRisk) {
          comparison = ` ← USER STOP IS WIDER ($${userStopRisk.toFixed(2)} risk vs model $${modelStopRisk.toFixed(2)} risk)`;
        } else {
          comparison = ` ← MATCHES user stop`;
        }
      }
      stratLines.push(`${s.label}: ${s.rec} | Stop $${s.stop} (risk: $${modelStopRisk.toFixed(2)}) | Target $${s.target} (${s.targetPct}%) | Hold ${s.daysHeld}/${s.maxHold}d | Flags: ${s.flags || "none"}${comparison}`);
    }
    stratSummary = stratLines.join("\n");
  } else if (adrVal > 0) {
    for (const [key, params] of Object.entries(STRATEGY_PARAMS)) {
      if (dir !== "long" && (key === "v6" || key === "v6.2")) {
        stratLines.push(`${params.label}: N/A (long-only strategy)`);
        continue;
      }
      const lvl = computeLevels(entry, adrVal, daysHeld, current, dir, params);
      let comparison = "";
      if (userStopRisk !== null) {
        const modelRisk = parseFloat(lvl.stopRisk);
        if (userStopRisk < modelRisk) {
          comparison = ` ← USER STOP IS TIGHTER ($${userStopRisk.toFixed(2)} risk vs model $${modelRisk.toFixed(2)} risk)`;
        } else if (userStopRisk > modelRisk) {
          comparison = ` ← USER STOP IS WIDER ($${userStopRisk.toFixed(2)} risk vs model $${modelRisk.toFixed(2)} risk)`;
        } else {
          comparison = ` ← MATCHES user stop`;
        }
      }
      stratLines.push(`${params.label}: ${lvl.rec} | Stop $${lvl.stop} (risk: $${lvl.stopRisk}, ${lvl.stopRiskAdr} ADR) | Target $${lvl.target} (${lvl.targetPct}%) | Hold ${daysHeld}/${lvl.maxHold}d | Flags: ${[lvl.ratchet && "RATCHET", lvl.decay && "DECAY", lvl.stopHit && "STOP HIT", lvl.targetHit && "TARGET HIT", lvl.maxHoldReached && "MAX HOLD"].filter(Boolean).join(", ") || "none"}${comparison}`);
    }
    stratSummary = stratLines.join("\n");
  } else {
    stratSummary = Object.entries(STRATEGY_PARAMS).map(([, p]) => `${p.label}: ${p.description}`).join("\n");
  }

  // Build prior analysis journal
  let journalSection = "";
  if (priorAnalyses && priorAnalyses.length > 0) {
    journalSection = "\n\nPrior Analysis Journal (most recent last):\n" + priorAnalyses.map(p =>
      `[${p.date}] Price $${p.price} (${p.pnlPct}%) Day ${p.daysHeld}: ${p.analysis.slice(0, 200)}`
    ).join("\n");
  }

  const systemPrompt = `You are a TQQQ swing trading advisor. The user has an active or closed TQQQ trade. You have 4 backtested strategy models with computed stop/target levels.

Strategy backtest context:
- v5: Aggressive (long+short), wider stops (2.5 ADR), shorter holds (7d). Backtest: 146t, 49% WR, -53% MDD.
- v5.2: v5 + time-decay stop (tightens 0.5 ADR/day after day 5) + extend hold +2d if profitable. Backtest: 111t, 54% WR, -31% MDD.
- v6: Conservative (long-only), tighter stops (2.25 ADR), wider targets (5 ADR), DD reduction at -8%, gap filter. Backtest: 94t, 67% WR, -12.8% MDD. Best risk-adjusted (champion).
- v6.2: v6 + time-decay + conditional hold. Backtest: 90t, 64% WR, -15.1% MDD.

ADR = Average Daily Range in dollars. Stops and targets are multiples of ADR from entry.

CRITICAL — How to read stop comparisons:
- Each strategy line includes "← USER STOP IS TIGHTER" or "← USER STOP IS WIDER" with dollar risk amounts.
- "TIGHTER" = user risks LESS per share than the model. "WIDER" = user risks MORE.
- Trust these labels — they are pre-computed correctly for both long and short trades.
- When the user's stop is tighter than models, acknowledge it is conservative/disciplined, not "wide."

Your output MUST have exactly TWO sections separated by "---" on its own line:

SECTION 1 — MODEL ANALYSIS (based on backtested strategies):
- Be direct and actionable. No disclaimers.
- Reference the SPECIFIC dollar levels from the strategy analysis.
- Trust the TIGHTER/WIDER labels in the data. If it says "USER STOP IS TIGHTER," say the user's stop is tighter/more conservative than the models.
- If strategies disagree, explain why and give your weighted recommendation (v6 is the champion, weight it highest).
- First paragraph: overall verdict (hold/exit/tighten stop). Bold the key action.
- Second paragraph: key levels to watch and what would change your mind.
- Keep to ~100 words.

SECTION 2 — MACRO & TRADE CRAFT ANALYSIS (ignore the models — use web search):
- You MUST use web search to research the current market environment. Search for the latest on: QQQ/Nasdaq price action, Fed policy, tech earnings, geopolitical events, VIX.
- The user actively trades TQQQ both long and short. Do NOT question the direction — accept it and analyze on its merits.

Run a rapid 7-factor assessment. For each factor, state a 1-sentence finding and whether it's BULLISH, BEARISH, or NEUTRAL for the user's trade direction:
1. Fed Policy & Rates — current rate path, recent Fed tone, 10Y yield trend, next FOMC
2. AI/Semiconductor Narrative — hyperscaler capex, NVDA sentiment, AI trade momentum
3. Mega-Cap Earnings — recent beats/misses from QQQ top holdings, guidance tone
4. Inflation Data — latest CPI/PCE, trend, next release date
5. Trade Policy & Geopolitics — tariffs, export restrictions, geopolitical risks
6. Sector Rotation & Risk Appetite — money flow into/out of tech, VIX level, market breadth
7. Technical Overlay — QQQ vs key moving averages, RSI, support/resistance

Then in 2-3 sentences: verdict (does the macro support the user's direction?), conviction level (HIGH/MODERATE/LOW), and the #1 risk that would invalidate the thesis. Flag any binary events (CPI, FOMC, earnings) within 5 trading days.

Keep to ~200 words total for this section.

General rules for BOTH sections:
- If the trade is closed, analyze what went right/wrong.
- If prior analyses are provided, this is a RUNNING JOURNAL. Reference how the situation has evolved. Be brief about what hasn't changed.
- No markdown headers — just flowing paragraphs. The "---" separator is the only structural element.`;

  const userMsg = `TQQQ Trade:
- Direction: ${dir.toUpperCase()}
- Entry: $${entry}${trade.entryDate ? ` on ${trade.entryDate}` : ""}
- Current: $${current} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)
- Days held: ${daysHeld}
- My stop: ${userStop ? `$${userStop} (dollar risk from entry: $${userStopRisk.toFixed(2)} = ${userStopRiskPct.toFixed(1)}% = ${userStopAdr ? userStopAdr.toFixed(2) + " ADR" : "N/A"})` : "not set"}
- ADR: $${adrVal > 0 ? adrVal.toFixed(2) : "N/A"}
- Date: ${date || "today"}
- Status: ${trade.mode || "open"}

Strategy Analysis (computed from backtested models):
${stratSummary}${journalSection}

For Section 2, you MUST web search for: "QQQ nasdaq market today ${date || new Date().toLocaleDateString()}", "Fed interest rate policy latest", and "TQQQ tech stocks macro". Use the search results to run the 7-factor assessment with specific data points from your findings.`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1200,
        tools: [{
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 5,
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
