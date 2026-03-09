# ThemePulse AI Analysis — Incremental Price Action Update

The tickers in this run are the same as the previous analysis. Do NOT re-research fundamentals, earnings, or company background. Only update the intraday price action.

## STEP 1 — Read existing data

1. Read `public/data/ai_analysis.json` — this is the existing analysis with full research tabs
2. Read `public/dashboard_data.json` — this has the latest price/volume/change data

## STEP 2 — Update each ticker's live data

For each ticker in the existing analysis, pull fresh values from `dashboard_data.json` (check both `stocks` array and `momentum_burst` array):
- `change_pct` — updated intraday change
- `close` / `price` — current price
- `rel_volume` / `vol_ratio` — current relative volume
- `volume` — current volume
- `rs_rank` — current RS rank
- `dollar_move`, `close_range` — from momentum_burst entry if available

## STEP 3 — Update key_takeaways with price action

Prepend a short **Price Action Update** section to the top of each ticker's `key_takeaways` tab. Keep ALL existing content below it.

Format:
```
### Intraday Update (HH:MM ET)
- **Price** $XX.XX (Chg% from open) — brief 1-line read on how the move is holding
- **Volume** X.XM shares (X.Xx avg) — pace vs typical
- **Key Level** — nearest support/resistance being tested

---

<existing key_takeaways content unchanged>
```

Keep this section to 2-4 bullets max. Be specific about price levels and volume pace.

## STEP 4 — Update the summary

Update the `content` field's header to note this is a price-action refresh:

```
# Momentum Burst Analysis

**N stocks** triggered Momentum Burst signals on YYYY-MM-DD.
**X BUY** | **Y HOLD** | **Z AVOID**
*Updated HH:MM ET — price action refresh*

### Top BUY Candidates
- **TICK** $XX.XX (+X.X%) — one-line update on how the trade is working
```

## STEP 5 — Write updated JSON

Write to `public/data/ai_analysis.json`. Preserve the exact same schema:
- Update `updated_at` to current UTC timestamp
- Update each ticker's `change_pct` from fresh dashboard data
- Update each ticker's `key_takeaways` tab with the price action prepend
- Update `content` summary with refresh note
- **Keep all other tabs (signals, revenue, thesis, risks) EXACTLY as they are — do not modify them**
- Keep `filters`, `grade`, `market_cap`, `company`, `verdict` unchanged

## QUALITY RULES

1. **This is a lightweight update.** Do NOT web search for earnings or fundamentals — that data is already in the existing tabs
2. **Preserve all existing content.** Only prepend to key_takeaways, don't rewrite
3. **Use real numbers from dashboard_data.json.** Don't estimate or round
4. **Be brief.** The price action section should be 3-4 lines max per ticker
5. **Note the time.** Include ET time in the update header so the user knows when it was refreshed
