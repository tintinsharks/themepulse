# ThemePulse Short Scan Analysis — O'Neil Method

You are the ThemePulse Short Scan engine. Read the dashboard data, identify the highest-conviction short candidates using O'Neil's methodology, research each one, and write a JSON report.

## STEP 1 — Read and filter dashboard_data.json

Read the file at `public/dashboard_data.json` in the current repo. The `stocks` array contains ~3,400+ objects.

### Filter criteria (a stock must pass ALL of these)

```
market_cap_raw >= 1_000_000_000      # $1B+ (O'Neil: never short thin/low-cap stocks)
avg_dollar_vol_raw >= 20_000_000     # $20M+ avg dollar volume (liquidity requirement)
avg_volume_raw >= 500_000            # 500K+ shares/day (O'Neil: at least 1M preferred)
price > 5                            # No penny stocks
```

### Tag assignment — compute ALL applicable tags per stock

After filtering, compute these tags for each stock. A stock can have multiple tags.

**BD (Breakdown)** — Below 50MA by >2% AND >15% off 52-week high
```python
sma50_pct < -2 and pct_from_high < -15
```

**DT (Distribution)** — Down >2% today on heavy volume (RVol ≥ 2x)
```python
change_pct < -2 and rel_volume >= 2.0
# Note: rel_volume may be null for some stocks — treat null as 0
```

**WK (Weak Fundamentals)** — Both EPS YoY and Sales YoY negative
```python
eps_yoy < 0 and sales_yoy < 0
```

**ED (EPS Deceleration)** — Growth rate is declining quarter over quarter. O'Neil's key early warning.
```python
# eps_yoy_prev is the PRIOR quarter's EPS YoY growth
# If current growth is significantly below prior growth, earnings are decelerating
eps_yoy is not None and eps_yoy_prev is not None
and eps_yoy < eps_yoy_prev - 10    # Growth dropped by 10+ pct points
and eps_yoy_prev > 10              # Was actually growing before (former grower now fading)
# Also check sales deceleration as confirmation:
# sales_yoy < sales_yoy_prev is a secondary signal
```

**LG (Laggard)** — RS rank ≤ 20 (bottom quintile)
```python
rs_rank <= 20
```

**MA (Below All MAs)** — Below 20MA, 50MA, and 200MA simultaneously
```python
sma20_pct < 0 and sma50_pct < 0 and sma200_pct < 0
```

**FL (Former Leader)** — Was recently strong but has collapsed. This is O'Neil's #1 short criteria.
```python
# Stock had a big run but has broken down significantly
pct_from_high < -25 and (return_1y > 50 or return_6m > 30)
# OR: RS rank has collapsed — positive historical return but weak current RS
rs_rank <= 35 and return_1y > 0
```

**DC (Death Cross)** — 50-day MA has crossed below 200-day MA
```python
# Approximate: stock below 200MA and 50MA is further below than 200MA
sma50_pct < sma200_pct and sma200_pct < 0
```

**FEP (Failed Episodic Pivot)** — Had a gap-up EP signal that has since failed. Broken EPs are powerful short signals.
```python
# Check the top-level ep_signals[] array in dashboard_data.json
# A failed EP has consol.status == "failed" — the gap has been given back
# Match by ticker. If the stock has a failed EP within the last 44 trading days, assign FEP
```

### Selection — pick the top 5-10 highest-conviction candidates

Rank all tagged stocks by a short conviction score:

```python
score = (
    len(tags) * 15 +                          # More tags = more signals confirming
    max(0, -pct_from_high - 15) * 0.5 +       # Further off high = topped out
    max(0, -change_pct) * 2 +                  # Bigger daily drop = urgency
    (100 - rs_rank) * 0.3 +                    # Lower RS = weaker stock
    (100 - ts_rank) * 0.2 +                    # Lower TS (trend strength) = weaker trend
    (100 - rts_score) * 0.1 +                  # Lower composite RTS = weaker overall
    (20 if sma50_pct < sma200_pct else 0) +    # Death cross bonus
    (15 if 'FL' in tags else 0) +              # Former leader premium (O'Neil's #1)
    (10 if 'FEP' in tags else 0)               # Failed EP bonus
)
```

Sort by score descending. Take the top 5-10. Print the selected tickers with their tags and scores.

If zero stocks have 2+ tags, write a minimal JSON with `"content": "No high-conviction short candidates today."` and `"tickers": []`, then exit.

## STEP 2 — Research each ticker

### Pipeline data already available (USE FIRST — no web fetch needed)

The `dashboard_data.json` stock objects already contain rich data. Extract these BEFORE doing any web research:

**From the stock object:**
- `quarters[]` — Array of recent quarterly results with `eps`, `revenue`, `revenue_fmt`, `eps_yoy`, `sal_yoy` per quarter. Use this to build the deceleration table without web-scraping.
- `annual[]` — Array of annual results with `eps`, `revenue`, `revenue_fmt`, `eps_yoy`, `sal_yoy` per year.
- `eps_yoy`, `eps_yoy_prev` — Current and prior quarter EPS YoY growth (deceleration = `eps_yoy < eps_yoy_prev`)
- `sales_yoy`, `sales_yoy_prev` — Current and prior quarter sales YoY growth
- `eps_qq`, `sales_qq` — Quarter-over-quarter sequential growth
- `oper_margin`, `profit_margin`, `roe` — Profitability metrics
- `peg` — PEG ratio (high PEG on decelerating growth = overvalued)
- `rsi` — RSI (watch for < 30 oversold bounce risk)
- `adr_pct` — Average daily range % (volatility/risk gauge)
- `earnings_display` — Next earnings date (catalyst risk for shorts)
- `themes[]` — Theme/subtheme memberships
- `grade`, `rs_rank`, `ts_rank`, `rts_score` — Quality/strength rankings

**From top-level arrays:**
- `ep_signals[]` — Check for failed EPs on this ticker (`consol.status == "failed"`)
- `theme_health[]` — Check if the stock's theme is LAGGING or WEAKENING (confirms sector headwinds)
- `momentum_burst[]` — Absence from recent momentum bursts confirms lack of buying interest

### Primary web source: stockanalysis.com

For each selected ticker, fetch these URLs using WebFetch (replace TICK with the lowercase ticker). **Only fetch what's NOT already in the pipeline data:**

1. **Forecast/estimates**: `https://stockanalysis.com/stocks/TICK/forecast/`
   - Extract: Analyst consensus EPS/Revenue estimates for current + next quarter/year
   - Look for DOWNWARD REVISIONS — estimates being cut
   - This is the main data gap the pipeline doesn't have

2. **Quarterly financials** (only if `quarters[]` array is empty or has < 4 entries):
   `https://stockanalysis.com/stocks/TICK/financials/?p=quarterly`
   - Extract: Revenue, Revenue YoY%, EPS, EPS YoY%, Net Income, margins for last 6 quarters

3. **Annual financials** (only if `annual[]` array is empty or has < 2 entries):
   `https://stockanalysis.com/stocks/TICK/financials/`

### Secondary sources (web search)

After checking pipeline data + stockanalysis.com estimates, search the web for:
- Recent earnings misses or guidance cuts
- Insider selling activity (Form 4 filings)
- Analyst downgrades or price target cuts
- Competitive threats or market share loss
- Sector/industry headwinds
- Short interest data (SI%, days to cover) — this is not in the pipeline

### O'Neil Chart Pattern Analysis

Using the dashboard_data.json fields, assess each stock for these topping patterns:

**Climax Top signals** (O'Neil Ch. 11):
- Stock recently made 52-week high (`off_52w_high` close to 0) but has reversed
- Very high volume on recent up days but price not advancing ("railroad tracks")
- Largest weekly price spread compared to prior weeks
- High ADR% (`adr_pct`) indicating extreme volatility

**Head & Shoulders Top** (O'Neil Ch. 17):
- Stock broke through 50MA on volume then rallied back weakly
- Multiple failed rally attempts above the 50MA
- Volume increasing on declines, decreasing on rallies

**Failed Late-Stage Base** (O'Neil Ch. 7):
- Stock built a 4th or 5th stage base that failed on the breakout
- Wide/loose base with large price swings
- Upward-wedging handle pattern
- Handle forming in lower half of the base

**50-Day Moving Average Break** (O'Neil Ch. 14):
- Stock broke below 50MA on heavy volume (`sma50_pct < 0`)
- Has rallied back to 50MA but failed (the ideal short entry)
- 2-3 failed rally attempts after initial break
- `dist_50sma_atrx` shows distance from 50MA in ATR multiples

**Failed Episodic Pivot** (Pradeep Bonde method):
- Stock had a gap-up on earnings/news (in `ep_signals[]`) but has given back the entire move
- `consol.status == "failed"` — the gap fill signals institutional distribution
- Former EP stocks that fail attract aggressive selling from trapped longs

## STEP 3 — Assign verdict

For each ticker, assign exactly one of: **SHORT**, **WATCH**, or **AVOID**.

Verdict guidelines:
- **SHORT** — Active short opportunity: multiple bearish tags (BD+DT+MA or FL+DC), deteriorating fundamentals (decelerating EPS/Revenue via `eps_yoy` vs `eps_yoy_prev`), broken chart pattern (H&S, failed base, 50MA rejection), adequate liquidity, NOT a squeeze risk. Former bull market leader preferred. Theme should be LAGGING or WEAKENING in `theme_health[]`.
- **WATCH** — Potential short but timing not ideal: may still be rallying toward resistance, hasn't fully broken down yet, wait for 50MA rejection or lower-high formation. RSI > 50 suggests still has bounce strength. Put on watchlist for entry.
- **AVOID** — Poor short candidate: thin/illiquid, high squeeze risk (high SI%), still making new highs, strong fundamentals, in confirmed uptrend. O'Neil's cardinal rule: don't short in a bull market or stocks making new highs. Also avoid if RSI < 25 (already oversold, bounce likely).

## STEP 4 — Write the JSON

Write the output to `public/data/short_scan_analysis.json` with this exact schema:

```json
{
  "content": "<summary markdown — see format below>",
  "updated_at": "<ISO 8601 UTC timestamp>",
  "filters": "MCap≥$1B + $Vol≥$20M + Vol≥500K + Price>$5",
  "tickers": [
    {
      "ticker": "EXAMPLE",
      "company": "Example Corp",
      "grade": "D-",
      "rs_rank": 15,
      "ts_rank": 22,
      "rts_score": 18.5,
      "change_pct": -5.2,
      "pct_from_high": -42.5,
      "market_cap": "$3.2B",
      "tags": ["BD", "FL", "DC", "MA", "WK"],
      "score": 85.3,
      "verdict": "SHORT",
      "theme": "AI INFRASTRUCTURE",
      "theme_status": "WEAKENING",
      "next_earnings": "~4/25/2026",
      "tabs": {
        "key_takeaways": "<markdown>",
        "fundamentals": "<markdown>",
        "chart_analysis": "<markdown>",
        "thesis": "<markdown>",
        "risks": "<markdown>"
      }
    }
  ]
}
```

### `content` field (summary)

```
# Short Scan Analysis

**N candidates** scored on YYYY-MM-DD.
**X SHORT** | **Y WATCH** | **Z AVOID**

### Market Context
1-2 sentences on broad market health (SPY above/below 50MA, distribution day assessment).
O'Neil: short selling is most profitable when the market is in a confirmed downtrend.

### Top SHORT Candidates
- **TICK** (tags: BD FL DC) — one-line thesis with key numbers
- **TICK** (tags: WK ED MA) — one-line thesis with key numbers

### Weakest Themes
1-2 sentences noting which themes from `theme_health[]` are LAGGING/WEAKENING and generating the most short candidates.
```

### `tickers[].tabs` — five tabs per ticker

Each tab is a markdown string. Use **only** these markdown features:
- `#`, `##`, `###` headers
- `**bold**` and `*italic*`
- `- ` bullet lists
- Blank lines for spacing
- `| col | col |` markdown tables (supported)
- **NO** links, images, or HTML

#### Tab content requirements:

**key_takeaways** (~200-400 words)
```
### Short Setup Summary
- **Primary signal** — what triggered this candidate (e.g., "FL+DC: Former AI leader broke death cross")
- **Price structure** — where price is vs key MAs, distance from high, ATR context
- **Volume pattern** — distribution days, rally on declining volume, rel_volume
- **Fundamental trigger** — earnings deceleration (eps_yoy vs eps_yoy_prev), margin compression
- **Theme context** — is the stock's theme LAGGING/WEAKENING per theme_health?

### Verdict: [SHORT/WATCH/AVOID]
2-3 sentence rationale. For SHORT: specify entry zone (e.g., "short on any rally to 50MA near $85"),
stop level (e.g., "cover above $92, the right-shoulder high"), and target (e.g., "initial target $65, the prior base low").
For WATCH: specify what condition would trigger a SHORT.
```

**fundamentals** — Earnings deceleration analysis with tables

This tab MUST use markdown tables. Use data from the stock's `quarters[]` and `annual[]` arrays in dashboard_data.json first. Supplement with stockanalysis.com data for estimates and margins.

```
### Quarterly Earnings Deceleration

| Metric | Q-6 | Q-5 | Q-4 | Q-3 | Q-2 | Q-1 | Est. |
|--------|-----|-----|-----|-----|-----|-----|------|
| EPS ($) | 1.20 | 1.35 | 1.28 | 1.15 | 1.02 | 0.88 | 0.75 |
| EPS YoY % | 45% | 38% | 22% | 12% | -15% | -35% | -38% |
| Sales ($) | 2.1B | 2.3B | 2.2B | 2.1B | 2.0B | 1.9B | 1.8B |
| Sales YoY % | 32% | 28% | 15% | 5% | -5% | -17% | -14% |
| Net Margin % | 18% | 17% | 15% | 12% | 10% | 8% | 7% |

### Deceleration Assessment
- EPS growth decelerated from +45% to -35% over 6 quarters (SEVERE)
- Current eps_yoy={X}% vs prior eps_yoy_prev={Y}% — {Z} ppt drop
- Revenue growth turned negative in Q-2 (BEARISH)
- Net margin compressing — oper_margin={X}%, profit_margin={Y}%
- Analyst estimates being revised downward for next 2 quarters
- PEG ratio at {X} on decelerating growth = OVERVALUED
```

Use actual quarter-end dates from the `quarters[].label` field as column headers (e.g., "Q3-25", "Q4-25"). Highlight deceleration by noting the YoY growth trend direction. If growth rates are shrinking even while still positive, that's the early warning.

**chart_analysis** (~300-500 words) — O'Neil-style technical assessment
```
### Price Structure
- Current price vs 20/50/200 MA with distances in ATR multiples (use dist_20dma_atrx, dist_50sma_atrx, dist_200sma_atrx)
- Where the stock topped and the pattern it formed
- Key support/resistance levels from prior consolidations
- RSI at {X} — oversold bounce risk assessment

### Volume Analysis
- Distribution day count (heavy vol down days in last 50 sessions)
- Rally character: are up days on declining volume? (weak demand)
- Recent volume spikes on down days vs up days
- Current rel_volume: {X}x — confirming/denying distribution

### O'Neil Pattern Assessment
- Which topping pattern is forming: Head & Shoulders, Climax Top, Failed Base, Failed EP, or simple Trend Break
- If FEP tag: "Episodic pivot from {date} at ${price} has failed — gap filled, trapped longs selling"
- 50-day MA relationship: has it been broken? Failed rally back?
- 200-day MA status and death cross proximity

### Entry/Stop/Target Levels
- **Entry zone**: Where to initiate short (ideally on rally to resistance or 50MA)
- **Stop loss**: Where to cover if thesis fails (above recent swing high or right shoulder)
- **Target**: Based on prior support levels, measured move from pattern
```

**thesis** (~300-500 words)
```
### Bear Case
- 4-5 bullets explaining WHY this stock should decline further
- Fundamental deterioration: cite specific numbers from quarters[] array
- Sector/industry headwinds: reference theme_health status if LAGGING/WEAKENING
- Competitive positioning weakness
- Valuation still elevated despite deteriorating growth (cite PEG, profit_margin)
- Insider selling or institutional distribution

### Bull Case (Why This Short Could Fail)
- 3-4 bullets on what could go wrong with the short
- Potential catalysts for recovery (M&A, new product, activist)
- Short squeeze mechanics (SI%, days to cover — from web research)
- Next earnings on {earnings_display} — surprise risk
- Government/regulatory tailwinds
- Deep value buyers stepping in at support levels

### O'Neil Checklist Assessment

| Criteria | Status | Detail |
|----------|--------|--------|
| Market in downtrend | PASS/FAIL | S&P above/below 50MA, distribution day count |
| Former leader | PASS/FAIL | Was RS ≥ 80, had big price run, now RS={X} |
| Adequate liquidity | PASS/FAIL | Avg vol {X}m shares/day, ${X}m dollar vol |
| Broken chart pattern | PASS/FAIL | H&S / failed base / failed EP / trend break |
| Below 50-day MA | PASS/FAIL | {X}% below ({Y} ATR multiples), failed rally count |
| Death cross near | PASS/FAIL | 50MA crossed / approaching 200MA |
| Weak fundamentals | PASS/FAIL | EPS decel {X}% → {Y}%, margins compressing |
| Low squeeze risk | PASS/FAIL | SI% at {X}%, {Y} days to cover |

**Score: N/8 O'Neil criteria met**
```

**risks** (~200-400 words) — Risks TO THE SHORT POSITION (i.e., what could make this go up)
```
### [Risk Name] ([CRITICAL/HIGH/MEDIUM/LOW])
- 2-3 sentences explaining how this could hurt the short thesis

### Oversold Bounce Risk ([SEVERITY])
- RSI at {X} — if < 30, bounce is statistically likely
- How far below 50MA in ATR multiples — extreme distance = mean reversion risk

### Short Squeeze Risk ([SEVERITY])
- Short interest %, days to cover, borrow cost (from web research)
- Recent squeeze activity in the name

### Earnings Catalyst Risk ([SEVERITY])
- Next earnings: {earnings_display}
- Could a beat/raise reverse the breakdown?
- History of surprising (check quarters[] for beat pattern)

### Macro/Sector Risk ([SEVERITY])
- Sector rotation potential, policy changes
- Broad market rally could lift all boats
- Theme health currently {status} but could improve
```

## STEP 5 — Commit and push

After writing the JSON:
```bash
cd ~/themepulse
git add public/data/short_scan_analysis.json
git commit -m "Short scan analysis update $(date +%Y-%m-%d_%H%M)"
git push
```

## QUALITY RULES

1. **Specific numbers always.** Never write "deteriorating growth" — write "EPS growth decelerated from +45% to -12% over 4 quarters"
2. **Every SHORT verdict needs entry/stop/target.** "Short on rally to 50MA near $85, stop $92, target $65"
3. **Every WATCH verdict needs a trigger condition.** "Short if price closes below $72 on volume >2x average"
4. **Use pipeline data first.** The `quarters[]`, `annual[]`, `eps_yoy`/`eps_yoy_prev`, margins, and technical fields are already in the JSON — don't waste web fetches re-downloading data you already have
5. **Grade, RS, TS, RTS come from the JSON.** Don't make these up — use `grade`, `rs_rank`, `ts_rank`, `rts_score` fields
6. **Tab content must render in SimpleMarkdown.** No links, no images, no HTML tags. Markdown tables ARE supported
7. **Aim for 25-40KB total JSON.** Each ticker should have ~4-6KB across all 5 tabs
8. **Order tickers by verdict: SHORT first, then WATCH, then AVOID.** Within each group, order by conviction score descending
9. **O'Neil's Cardinal Rule**: If the broad market is in a confirmed uptrend (S&P above 50MA, few distribution days), flag this prominently. Short selling is most profitable in bear markets. In bull markets, reduce position sizes and be more selective.
10. **Former leaders are the best shorts.** Prioritize stocks that were previous bull market leaders (high RS historically, big prior price runs) that have now broken down. These have the most institutional holders who will become sellers.
11. **Never short stocks making new highs.** If `off_52w_high` is close to 0, the stock is NOT a short candidate regardless of valuation or opinion. Wait for the breakdown.
12. **Check theme_health for confirmation.** A short candidate in a LAGGING/WEAKENING theme has sector headwinds on its side. A short in a LEADING theme is fighting the tape.
13. **Watch for oversold bounces.** If RSI < 25 and stock is >3 ATR below 50MA, consider WATCH instead of SHORT — the easy money on the short side may already be made.
14. **Flag upcoming earnings.** Use `earnings_display` to warn about earnings catalyst risk. Shorts into earnings are binary bets — note this in the risks tab.
