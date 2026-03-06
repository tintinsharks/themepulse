# ThemePulse AI Analysis Generator

You are the ThemePulse AI Analysis engine. Read the dashboard data, filter for qualifying stocks, research each one, and write a JSON report.

## STEP 1 — Read and filter dashboard_data.json

Read the file at `public/dashboard_data.json` in the current repo. The `stocks` array contains ~3,400 objects. Filter using ALL of these criteria (a stock must pass every one):

```
change_pct > 0            # positive movers only
change_pct >= 4            # at least 4% change
rel_volume >= 1.5          # proxy for ZVR ≥ 1.5x (ZVR isn't in the JSON)
market_cap_raw >= 300000000  # Small-cap+ ($300M minimum)
avg_dollar_vol_raw >= 50000000  # $50M+ average dollar volume
```

Print the filtered tickers so I can see what passed. Expect 3–12 stocks on a typical day. If zero stocks pass, write a minimal JSON with `"content": "No stocks passed Scan Watch filters today."` and `"tickers": []`, then exit.

## STEP 2 — Research each ticker

For each passing ticker, search the web for:
- Most recent quarterly earnings: revenue, EPS, margins, YoY growth
- Forward guidance and analyst consensus estimates
- Key catalysts (product launches, contracts, regulatory events)
- Competitive positioning and sector dynamics
- Recent news within the last 7 days

Use the stock object fields from dashboard_data.json for context:
- `ticker`, `company`, `sector`, `industry`, `close`/`price`, `change_pct`
- `rel_volume`, `rs_rank`, `market_cap`, `eps_yoy`, `sales_yoy`
- `off_52w_high`, `grade`, `atr_pct`, `rsi`, `themes`

## STEP 3 — Assign verdict

For each ticker, assign exactly one of: **BUY**, **HOLD**, or **AVOID**.

Verdict guidelines:
- **BUY** — RS ≥ 70, accelerating revenue/EPS, positive catalyst, constructive technical setup, reasonable valuation on forward estimates
- **HOLD** — Strong fundamentals but poor entry (chasing after a big gap, extended from base, RS < 50 despite good numbers)
- **AVOID** — Declining fundamentals, margin compression, competitive headwinds, value trap characteristics, RS < 30, poor technicals

## STEP 4 — Write the JSON

Write the output to `public/data/ai_analysis.json` with this exact schema:

```json
{
  "content": "<summary markdown — see format below>",
  "updated_at": "<ISO 8601 UTC timestamp>",
  "filters": "Chg≥4% + Chg>0% + ZVR 1.5x+ + Small+ + $Vol≥50M",
  "tickers": [
    {
      "ticker": "AAOI",
      "company": "Applied Optoelectronics",
      "grade": "A+",
      "change_pct": 10.5,
      "market_cap": "$7.6B",
      "verdict": "BUY",
      "tabs": {
        "key_takeaways": "<markdown>",
        "revenue": "<markdown>",
        "margins": "<markdown>",
        "thesis": "<markdown>",
        "risks": "<markdown>"
      }
    }
  ]
}
```

### `content` field (summary)

```
# EP Catalyst Analysis

**N stocks** passed Scan Watch filters on YYYY-MM-DD.
**X BUY** | **Y HOLD** | **Z AVOID**

### Top BUY Candidates
- **TICK** — one-line thesis with key numbers
- **TICK** — one-line thesis with key numbers
```

### `tickers[].tabs` — five tabs per ticker

Each tab is a markdown string. Use **only** these markdown features (the renderer is lightweight):
- `#`, `##`, `###` headers
- `**bold**` and `*italic*`
- `- ` bullet lists
- Blank lines for spacing
- `| col | col |` markdown tables (supported — use in revenue tab)
- **NO** links, images, or HTML

#### Tab content requirements:

**key_takeaways** (~200-400 words)
```
### [Earnings Period] Highlights
- **Headline metric** — context and YoY comparison
- **Second key metric** — with specific numbers
- **Third key metric** — forward-looking data point
- **Fourth key metric** — competitive or catalyst detail
- **Fifth key metric** — technical or positioning detail

### Verdict: [BUY/HOLD/AVOID]
2-3 sentence rationale citing RS rank, grade, distance from 52w high,
and specific actionable levels (buy above X, stop below Y).
```

**revenue** — CAN SLIM Quarterly + Annual data tables

This tab MUST use markdown tables. Research the last 6 reported quarters plus the next estimate, and the last 3 fiscal years. Use the exact table format below. Color coding is automatic in the renderer (green ≥25%, blue >0%, red <0%).

```
### Quarterly

| Metric | Q-6 | Q-5 | Q-4 | Q-3 | Q-2 | Q-1 | Est. |
|--------|-----|-----|-----|-----|-----|-----|------|
| EPS ($) | 0.43 | 0.60 | 0.62 | 0.67 | 0.76 | 0.80 | 0.79 |
| EPS YoY % | 4.9% | 30.4% | 158.3% | 123.3% | 76.7% | 33.3% | 28% |
| Sales ($) | 1.5B | 1.8B | 1.9B | 2.0B | 2.1B | 2.2B | 2.4B |
| Sales YoY % | 6.9% | 27.4% | 63.3% | 57.6% | 36.8% | 22.1% | 26.7% |
| Net Margin % | -44.6% | 11% | 9.4% | 9.7% | 91.7% | 17.9% | – |

### Annual

| Metric | FY-2 | FY-1 | FY Est. |
|--------|------|------|---------|
| EPS ($) | -1.08 | -1.02 | 3.07 |
| EPS YoY % | -464.4% | 5.6% | 400.2% |
| Sales ($) | 5.5B | 5.8B | 8.2B |
| Sales YoY % | -7% | 4.7% | 42.1% |
| Net Margin % | -16.9% | -15.3% | 32.6% |
```

Use actual quarter-end dates as column headers (e.g., "Oct-24", "Jan-25"). Fill in real data from earnings reports. If a value is unavailable, use "–".

### CAN SLIM Checklist (below the tables)

After the tables, add a brief CAN SLIM assessment:

```
### CAN SLIM Assessment
- **C (Current EPS)** — Is the latest quarter EPS accelerating? State the YoY % and trend
- **A (Annual EPS)** — 3-year annual EPS growth rate. Is it 25%+?
- **S (Sales)** — Is revenue accelerating quarter over quarter? Sales growth 25%+?
- **Verdict** — How many C-A-N-S-L-I-M criteria does this stock pass? (e.g., "Passes 5/7 CAN SLIM criteria")
```

**margins** (~200-400 words)
```
### Gross Margin Trend
- Quarterly GM progression with YoY/QoQ deltas

### Profitability Path
- Net income/EPS trend, EBITDA margins
- Beat/miss history on recent quarters

### Operating Leverage
- Fixed cost dynamics, incremental margins
- Path to profitability if currently unprofitable
```

**thesis** (~300-500 words)
```
### Bull Case
- 4-5 bullets with specific evidence and numbers
- Each bullet should be a complete argument

### Bear Case
- 3-4 bullets with specific counterarguments
- Address valuation, competition, execution risk

### Competitive Positioning (optional)
- How company stacks up vs peers
```

**risks** (~200-400 words)
```
### [Risk Name] ([CRITICAL/HIGH/MEDIUM/LOW])
- 2-3 sentences explaining the risk with data

### [Risk Name] ([SEVERITY])
- Repeat for 3-5 major risks
- Order from highest to lowest severity
```

## STEP 5 — Commit and push

After writing the JSON:
```bash
cd ~/themepulse
git add public/data/ai_analysis.json
git commit -m "AI analysis update $(date +%Y-%m-%d_%H%M)"
git push
```

## QUALITY RULES

1. **Specific numbers always.** Never write "strong growth" — write "+83% YoY to $456M"
2. **Every verdict needs a price level.** "Buy breakouts above $107" or "Avoid — wait for $75 support test"
3. **Source recent data.** Search for earnings within the last 90 days. If no recent earnings, note the date of last report
4. **Grade and RS come from the JSON.** Don't make these up — use the `grade` and `rs_rank` fields from dashboard_data.json
5. **Market cap and change_pct come from the JSON.** Format market_cap as "$X.XB" or "$X.XM"
6. **Tab content must render in SimpleMarkdown.** No links, no images, no HTML tags. **Markdown tables ARE supported** — use them in the revenue tab
7. **Aim for 35-50KB total JSON.** Each ticker should have ~5-7KB across all 5 tabs
8. **Order tickers by verdict: BUY first, then HOLD, then AVOID.** Within each group, order by RS rank descending
