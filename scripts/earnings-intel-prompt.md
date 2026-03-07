# ThemePulse Earnings Intelligence — S&P 500 Quarterly Analysis

You are the ThemePulse Earnings Intelligence engine. Research the current S&P 500 earnings season, analyze themes across all 11 GICS sectors, and write a comprehensive JSON report.

## STEP 1 — Determine the Current Earnings Quarter

From today's date, determine which earnings quarter is being reported:
- **Jan–Mar** → Q4 of prior year (e.g., Jan 2026 → "Q4 2025")
- **Apr–Jun** → Q1 of current year
- **Jul–Sep** → Q2 of current year
- **Oct–Dec** → Q3 of current year

Print the quarter you're analyzing (e.g., "Analyzing Q4 2025 earnings season").

## STEP 2 — Get S&P 500 Constituents

Use WebFetch to get the S&P 500 constituent list:
- URL: `https://en.wikipedia.org/wiki/List_of_S%26P_500_companies`
- Extract all ~500 tickers, their GICS sector, and GICS sub-industry
- Group them by the 11 GICS sectors:
  1. Information Technology
  2. Health Care
  3. Financials
  4. Consumer Discretionary
  5. Communication Services
  6. Industrials
  7. Consumer Staples
  8. Energy
  9. Utilities
  10. Real Estate
  11. Materials

Print the count per sector.

## STEP 3 — Research Each Sector

For each of the 11 GICS sectors, do the following:

### 3a. Web Search for Sector Earnings Themes
Use WebSearch for 2-3 queries per sector:
- `"{sector name}" S&P 500 earnings Q{N} {year} themes trends`
- `"{sector name}" earnings season guidance outlook {year}`
- `"{sector name}" companies earnings beats misses {quarter}`

Extract:
- Major recurring themes (e.g., "AI CapEx acceleration", "margin expansion", "consumer softness")
- Overall sector sentiment (bullish/bearish/mixed)
- Notable guidance changes (raised/lowered)

### 3b. Top Companies Detail
For the **5-10 largest companies by market cap** in each sector, use WebFetch on stockanalysis.com:
- `https://stockanalysis.com/stocks/{TICKER}/financials/?p=quarterly` (lowercase ticker)

For each company extract:
- Whether they beat or missed EPS/revenue estimates
- Key executive quote or theme from the earnings call
- Forward guidance sentiment

If stockanalysis.com is unavailable for a ticker, use WebSearch:
- `"{company name}" earnings Q{N} {year} results EPS revenue`

### 3c. Score Sector Sentiment
Assign a sentiment score from 0.0 to 1.0:
- **0.0–0.3**: Bearish (widespread misses, lowered guidance, margin compression)
- **0.3–0.5**: Cautious (mixed results, flat guidance)
- **0.5–0.7**: Neutral-positive (mostly beats, stable guidance)
- **0.7–0.9**: Bullish (strong beats, raised guidance, positive themes)
- **0.9–1.0**: Euphoric (blowout results across the board)

## STEP 4 — Synthesize Cross-Sector Themes

After researching all 11 sectors, identify **8-15 cross-cutting themes** that appear across multiple sectors. Examples:
- "AI Infrastructure Spending" — appears in Tech, Communication Services, Industrials
- "Margin Expansion via Automation" — appears in Industrials, Consumer Discretionary, Financials
- "Consumer Spending Resilience" — appears in Consumer Discretionary, Consumer Staples
- "Interest Rate Sensitivity" — appears in Financials, Real Estate, Utilities

For each theme:
- **name**: Short descriptive name (3-6 words)
- **frequency**: How many companies/sectors mentioned it (integer)
- **sentiment**: 0.0–1.0 score for this specific theme
- **sectors**: Object mapping sector name → brief note on how it manifests
- **keywords**: 3-5 related keywords
- **trend**: "accelerating", "stable", or "decelerating" vs prior quarter
- **tickers**: 3-8 most relevant tickers

## STEP 5 — Generate Momentum Signals

Based on your research, generate **8-15 actionable momentum signals**:

Each signal has:
- **signal**: Short name (e.g., "Cloud Revenue Acceleration")
- **type**: One of "bullish", "caution", or "transition"
- **description**: 2-3 sentence explanation with specific data points
- **tickers**: 3-6 relevant tickers
- **confidence**: 0.0–1.0

Signal guidelines:
- **Bullish**: Strong earnings beats, raised guidance, positive theme momentum
- **Caution**: Misses, lowered guidance, margin pressure, demand concerns
- **Transition**: Sector rotation signals, leadership changes, inflection points

## STEP 6 — Collect Notable Executive Quotes

Gather **15-25 notable executive quotes** from earnings calls. For each:
- **ticker**: Stock ticker
- **company**: Company name
- **sector**: GICS sector
- **executive**: Name and title (e.g., "Tim Cook, CEO")
- **quote**: The actual quote (1-3 sentences, verbatim or close paraphrase)
- **theme**: Which cross-sector theme it relates to
- **sentiment**: 0.0–1.0

Prioritize quotes that:
1. Reveal forward-looking guidance or strategy shifts
2. Comment on macro trends (AI, consumer, rates, trade)
3. Come from sector bellwethers (largest companies)

## STEP 7 — Write the JSON

Write the output to `public/data/earnings_intel.json` with this exact schema:

```json
{
  "updated_at": "<ISO 8601 UTC timestamp>",
  "quarter": "Q4 2025",
  "companies_analyzed": 484,
  "kpis": {
    "total_companies": 484,
    "themes_tracked": 12,
    "momentum_signals": 10,
    "avg_sentiment": 0.65,
    "sectors_covered": 11
  },
  "themes": [
    {
      "name": "AI Infrastructure Spending",
      "frequency": 45,
      "sentiment": 0.82,
      "sectors": {
        "Information Technology": "Hyperscaler CapEx up 40% YoY",
        "Communication Services": "Meta/Google increasing AI spend",
        "Industrials": "Data center construction boom"
      },
      "keywords": ["artificial intelligence", "capex", "data centers", "GPU", "cloud"],
      "trend": "accelerating",
      "tickers": ["NVDA", "MSFT", "GOOGL", "META", "AMZN"]
    }
  ],
  "sectors": [
    {
      "name": "Information Technology",
      "sentiment": 0.78,
      "companies": 75,
      "top_themes": ["AI Infrastructure Spending", "Margin Expansion via Automation"],
      "companies_detail": [
        {
          "ticker": "AAPL",
          "sentiment": 0.7,
          "themes": ["Services Growth", "China Recovery"],
          "key_quote": "Services revenue reached an all-time high of $26.3B — Tim Cook, CEO"
        }
      ]
    }
  ],
  "momentum_signals": [
    {
      "signal": "Cloud Revenue Acceleration",
      "type": "bullish",
      "description": "All three hyperscalers reported accelerating cloud revenue growth. AWS +19%, Azure +29%, GCP +35%. AI workload demand driving reacceleration after 3 quarters of deceleration.",
      "tickers": ["AMZN", "MSFT", "GOOGL"],
      "confidence": 0.88
    }
  ],
  "quotes": [
    {
      "ticker": "NVDA",
      "company": "NVIDIA",
      "sector": "Information Technology",
      "executive": "Jensen Huang, CEO",
      "quote": "The next industrial revolution has begun. Companies and countries are partnering with NVIDIA to shift the trillion-dollar traditional data centers to accelerated computing.",
      "theme": "AI Infrastructure Spending",
      "sentiment": 0.95
    }
  ]
}
```

## STEP 8 — Commit and push

After writing the JSON:
```bash
cd ~/Claude\ Theme/themepulse
git add public/data/earnings_intel.json
git commit -m "Earnings intel update $(date +%Y-%m-%d)"
git push
```

## QUALITY RULES

1. **Use specific numbers.** Never write "strong growth" — write "+28% YoY to $24.9B"
2. **Sentiment scores must be justified.** Don't assign 0.8 without explaining why (beats, guidance, themes)
3. **Quotes should be real.** Use actual executive quotes from earnings calls, not fabricated ones. If you can't find the exact quote, paraphrase clearly and note it
4. **Theme frequency must be accurate.** Count how many companies/earnings calls actually referenced the theme
5. **Cover all 11 sectors.** Every GICS sector must have at least 3 companies in `companies_detail`
6. **Momentum signals need evidence.** Each signal must cite specific earnings data or guidance
7. **Target 80-120KB JSON.** Enough detail to be useful, not so much it's bloated
8. **Order themes by frequency descending.** Most common themes first
9. **Order sectors by sentiment descending.** Most bullish sectors first
10. **Tickers in themes/signals should be S&P 500 members.** Don't reference small-caps here
