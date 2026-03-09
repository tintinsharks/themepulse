# ThemePulse Short Scan — Incremental Price Action Update

The tickers in this run are the same as the previous analysis. Do NOT re-research fundamentals, earnings, or company background. Only update the intraday price action.

## STEP 1 — Read existing data

1. Read `public/data/short_scan_analysis.json` — this is the existing analysis with full research tabs
2. Read `public/dashboard_data.json` — this has the latest price/volume/change data

## STEP 2 — Update each ticker's live data

For each ticker in the existing analysis, pull fresh values from `dashboard_data.json`:
- `change_pct` — updated intraday change
- `close` / `price` — current price
- `rel_volume` — current relative volume (may be null)
- `rs_rank` — current RS rank
- `ts_rank` — current trend strength rank
- `rts_score` — current composite RTS score
- `sma20_pct`, `sma50_pct`, `sma200_pct` — current MA distances
- `rsi` — current RSI

## STEP 3 — Update key_takeaways with price action

Prepend a short **Price Action Update** section to the top of each ticker's `key_takeaways` tab. Keep ALL existing content below it.

Format:
```
### Intraday Update (HH:MM ET)
- **Price** $XX.XX (Chg% today) — is the short thesis working? Price moving lower/bouncing?
- **Volume** X.Xx avg — selling pressure confirming/waning
- **Key Level** — nearest support being tested or resistance holding
- **MA Status** — updated distances: 50MA at X%, 200MA at X%

---

<existing key_takeaways content unchanged>
```

Keep this section to 3-5 bullets max. Focus on whether the short setup is improving or deteriorating.

## STEP 4 — Update the summary

Update the `content` field's header to note this is a price-action refresh:

```
# Short Scan Analysis

**N candidates** scored on YYYY-MM-DD.
**X SHORT** | **Y WATCH** | **Z AVOID**
*Updated HH:MM ET — price action refresh*

### Top SHORT Candidates
- **TICK** $XX.XX (chg%) — one-line update on how the short is tracking
```

## STEP 5 — Write updated JSON

Write to `public/data/short_scan_analysis.json`. Preserve the exact same schema:
- Update `updated_at` to current UTC timestamp
- Update each ticker's `change_pct`, `rs_rank`, `ts_rank`, `rts_score` from fresh dashboard data
- Update each ticker's `key_takeaways` tab with the price action prepend
- Update `content` summary with refresh note
- **Keep all other tabs (fundamentals, chart_analysis, thesis, risks) EXACTLY as they are — do not modify them**
- Keep `filters`, `grade`, `market_cap`, `company`, `verdict`, `tags`, `score` unchanged

## QUALITY RULES

1. **This is a lightweight update.** Do NOT web search for earnings or fundamentals — that data is already in the existing tabs
2. **Preserve all existing content.** Only prepend to key_takeaways, don't rewrite
3. **Use real numbers from dashboard_data.json.** Don't estimate or round
4. **Be brief.** The price action section should be 3-5 lines max per ticker
5. **Note the time.** Include ET time in the update header so the user knows when it was refreshed
6. **Flag if thesis is breaking.** If a SHORT candidate is rallying hard (change_pct > +3%), note this as a warning
