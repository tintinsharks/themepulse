# stockanalysis.com Scraper

Primary fundamentals source for the FMP → Schwab migration. Covers the ~40%
of data Schwab can't provide (fundamentals, company profile, float/short
interest, analyst forecasts, earnings calendar).

## Status

| Function | Status | Returns |
|---|---|---|
| `get_financials(ticker, period)` | ✅ tested on AAPL | Revenue, EPS, FCF, margins (quarterly/annual/trailing) |
| `get_cash_flow(ticker, period)` | ✅ tested on AAPL | OCF, ICF, FCF, capex, stock-based comp |
| `get_ratios(ticker, period)` | ⚠️ same shape as above, not smoke-tested | PE, PS, PB, P/FCF, EV/Sales, EV/EBITDA, ROE, ROA, ROIC |
| `get_profile(ticker)` | ✅ tested on AAPL | Description, CEO, sector, industry, employees, founded, IPO date, HQ, phone |
| `get_statistics(ticker)` | ✅ tested on AAPL | 30+ fields: float, short interest/%/ratio, insider%, institution%, valuation, earnings_date |
| `get_earnings_calendar()` | ✅ returns 4,700+ upcoming entries | ticker, name, bmo/amc, EPS est, rev est, market cap |
| `get_analyst_forecast(ticker)` | ⚠️ not verified — `/forecast/` HTML shape may differ | Price targets, upside %, analyst count |
| `canary()` | ✅ | Runs all five against AAPL, returns pass/fail per function |

## Quick start

```bash
cd "/Users/nprabhak/Claude Theme/themepulse/scripts/stockanalysis"
python3 scraper.py AAPL        # dump financials for AAPL
python3 scraper.py canary      # run all 5 validators, assert shapes intact
```

From code:

```python
from scraper import get_financials, get_statistics, get_earnings_calendar

f = get_financials("NVDA", period="quarterly")
# → {'periods': [...], 'revenue': [...], 'eps_diluted': [...], 'fcf': [...]}

s = get_statistics("NVDA")
# → {'shares_float_num': 2.4e10, 'short_pct_float_num': 1.2, 'earnings_date': 'May 21, 2026', ...}

cal = get_earnings_calendar()
# → {'count': 4698, 'entries': [{'ticker': 'WDS', ...}, ...]}
```

## Architecture

### Parsing strategy

stockanalysis.com pages fall into two shapes:

1. **Financials / cash flow / ratios** — server-rendered `<table id="main-table">`.
   Parse `<thead>` for period headers, `<tbody>` rows for label + values.
   `_parse_main_table()` does this. Values are strings (`"143,756"`, `"15.65%"`,
   `"-"`); `_num()` normalizes to float.

2. **Statistics page** — embeds a SvelteKit hydration payload with stable
   machine-readable ids:
   ```js
   {id:"shortInterest",title:"Short Interest",value:"126.77M",hover:"126,771,284"}
   ```
   `_STATS_JSON_RE` extracts these; `_STATS_ID_MAP` maps ids to our canonical
   field names. `hover` is the precise numeric value when available.

3. **Earnings calendar** — client-rendered from a compact SvelteKit payload:
   ```js
   {s:"AAPL",n:"Apple Inc.",t:"amc",e:2.14,eg:12.5,r:95400000000,rg:6.1,m:3.5e12}
   ```
   `_CALENDAR_ENTRY_RE` extracts all. No per-date URL — page returns all
   upcoming earnings. Filter client-side or cross-reference with
   `get_statistics(ticker)["earnings_date"]` for per-ticker date lookup.

4. **Company profile** — plain HTML `<tr><td>Label</td><td>Value</td></tr>`
   rows. `_extract_table_kv()` harvests them all; `_PROFILE_FIELDS` maps
   labels to canonical keys.

### Caching

- Disk cache at `~/.themepulse/sa_cache/` keyed by URL.
- Default TTL: 24h. Earnings calendar: 1h.
- Override with `fresh=True`.

### Rate limiting

- Serial only, ≥1s between requests (module-global `_LAST_REQ_AT`).
- Retries 3x on 429 with exponential backoff.
- Not safe for parallel process use — add `fasteners` lock before doing that.

### Cloudflare + datacenter IPs

Scraping from Vercel Edge Functions will NOT work — Cloudflare blocks their
datacenter IPs. **Pipeline-side only**, run from your Mac or GitHub Actions
with a normal egress IP.

## Wiring into the pipeline

Phase 5 of `MIGRATION_PLAN.md` calls for:

1. `09c_earnings_enrich.py` → swap FMP income-statement calls for
   `get_financials(ticker)` + `get_cash_flow(ticker)`
2. `09f_short_interest.py` → swap FMP shares-float for `get_statistics(ticker)`
3. `09f_margins.py` → swap FMP income-statement for `get_ratios(ticker)`
4. `09g_earnings_calendar.py` → swap FMP earning-calendar for
   `get_earnings_calendar()` + Nasdaq API fallback
5. Bake per-ticker results into `public/data/fundamentals.json` so
   `api/live.js` reads the static JSON instead of calling FMP live
6. Add a daily GitHub Action that runs `python3 scraper.py canary` and alerts
   via Pushover if any of the 5 shape checks fail

## Known limitations

- **HTML shape is fragile.** A stockanalysis.com redesign will break parsers.
  The canary is your early warning — run it daily.
- **Rate limit is soft.** ~1 req/s is polite. If you need to enrich 500+
  tickers daily, that's 8+ minutes — acceptable in a nightly pipeline.
- **Earnings calendar has no date-specific endpoint.** Use Nasdaq API if you
  need a specific-date earnings list.
- **`get_analyst_forecast` is unverified.** The `/forecast/` page structure
  hasn't been tested against the current implementation. Likely needs the
  same treatment as statistics (JSON payload extraction).
- **ToS gray area.** Good-faith scraping at 1 req/s with an identifying UA
  is normally fine, but stockanalysis could add CAPTCHA or IP-block you at
  any point. Have FMP fallback ready during the transition.
