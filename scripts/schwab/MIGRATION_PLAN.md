# FMP → Schwab Migration Plan

**Status:** Blocked on developer.schwab.com app approval (1-3 business days).
Don't start execution until OAuth bootstrap succeeds.

**Summary:** Schwab can replace ~60% of FMP usage (quotes, OHLC, index quotes,
market hours) with zero ongoing cost. The other ~40% is fundamentals,
earnings calendar, institutional data — **Schwab does not provide these** and
those call sites need a separate alternative (SEC EDGAR, stockanalysis.com
scrape, or a minimal FMP plan kept for fundamentals only).

---

## 1. Endpoint audit matrix

### ThemePulse frontend (`api/*.js`)

| File | FMP endpoint | What it's for | Schwab replacement | Notes |
|---|---|---|---|---|
| `api/live.js` | `/batch-quote` (watchlist) | Live watchlist quotes | `get_quotes(syms)` | Direct — loop over syms ≤500/call |
| `api/live.js` | `/batch-quote` (universe) | Theme universe quotes (~500 tickers) | `get_quotes(syms)` | Same, chunk if needed |
| `api/live.js` | `/batch-quote` (indices) | SPY/QQQ/IWM/VIX | `get_quotes()` + `$VIX.X` | Schwab uses `$VIX.X` not `VIX` |
| `api/live.js` | `/income-statement` | EPS/Rev quarterly + annual bars | **None — see §3** | Move to SEC EDGAR or scrape |
| `api/live.js` | `/cash-flow-statement` | FCF bars | **None — see §3** | Same |
| `api/live.js` | `/profile` | Sector / industry / company name | `get_instruments(sym, projection="fundamental")` | Partial fields; fill rest from scrape |
| `api/ohlc.js` | `/historical-chart/{1min,5min,15min,30min,1hour}` | Intraday chart bars | `get_price_history_every_*_minutes()` | schwab-py has per-interval helpers |
| `api/ohlc.js` | `/historical-price-eod/full` | Daily chart bars | `get_price_history_every_day()` | Schwab returns ~20yr default |
| `api/scan-scores.js` | `/batch-quote` | Scan candidate ranking | `get_quotes()` | Direct |
| `api/market-quality.js` | `/batch-quote` | Indices + sector ETFs | `get_quotes()` | Direct |
| `api/market-quality.js` | `/api/v3/quote/%5EVIX` | VIX | `get_quotes(["$VIX.X"])` | Symbol change |
| `api/market-quality.js` | `/api/v3/quote/%5ETNX` | 10yr yield | `get_quotes(["$TNX.X"])` | Symbol change |
| `api/analyze-ticker.js` | `FMP` base (read file) | Catalyst AI analysis inputs | TBD — open file first | Mix of quote + fundamentals likely |

### Stock pipeline (`~/Claude Theme/stock-pipeline/scripts/`)

| File | FMP usage | Schwab replacement |
|---|---|---|
| `01_fmp_extract.py` | Main batch extract (quotes + profiles) | Quotes → Schwab; profiles need alt |
| `09c_earnings_enrich.py` | `/income-statement` quarterly + annual, `/earnings` | **None — SEC EDGAR or yfinance** |
| `09e_vcs.py` | `/historical-price-eod/full` | `get_price_history_every_day()` |
| `09f_institutional.py` | `/institutional-ownership/symbol-positions-summary` | **None — SEC EDGAR 13F** |
| `09f_margins.py` | `/income-statement` | **None — SEC EDGAR or scrape** |
| `09f_short_interest.py` | `/shares-float` | **None — FINRA or scrape** |
| `09g_earnings_calendar.py` | `/earning-calendar`, `/earnings` | **None — Nasdaq or scrape** |
| `09g_macro_context.py` | `/quote` for macro symbols | `get_quotes()` |
| `09k_premarket_briefing.py` | `/historical-chart/5min` | `get_price_history_every_five_minutes()` |
| `09r_rvol_catalyst_scan.py` | Multiple endpoints (wrapper) | Partial — quotes yes, fundamentals no |
| `ep_backtest.py` | `/historical-price-eod/full` | `get_price_history_every_day()` |

### Frontend code (`src/App.jsx`)

No direct FMP calls — only reads fields returned by `api/*.js`. As long as
the Schwab-backed responses preserve the current JSON shape, App.jsx needs
**zero changes**.

---

## 2. Symbol translation (Schwab vs FMP)

Schwab uses different tickers for some instruments. Need a symbol-map util.

| FMP | Schwab |
|---|---|
| `VIX` or `^VIX` | `$VIX.X` |
| `^TNX` | `$TNX.X` |
| `^DJI` | `$DJI` |
| `^SPX` or `SPY` (when index wanted) | `$SPX.X` |
| `SPY`, `QQQ`, `IWM`, `DIA`, sector ETFs | Same ticker |
| `BRK.B` | `BRK/B` (slash instead of dot — verify at bootstrap) |

Put this in `scripts/schwab/symbol_map.js` + `.py` — import wherever needed.

---

## 3. What Schwab cannot do — alternatives

### Fundamentals (income statement, cash flow, earnings)

Used in: `api/live.js` chart-panel EPS/Rev/FCF bars, pipeline earnings enrich,
margins, AI analysis.

**Primary source: stockanalysis.com** (pre-normalized, free, no key, covers
~90% of the gap in one place). SEC EDGAR is reserved as a fallback for the
few things stockanalysis doesn't cover well.

| Need | stockanalysis.com URL | Used by |
|---|---|---|
| Income statement (EPS, Rev) Q | `/stocks/{sym}/financials/?p=quarterly` | `api/live.js` earnings bars, `09c_earnings_enrich.py` |
| Income statement (EPS, Rev) A | `/stocks/{sym}/financials/?p=annual` | same |
| Cash flow (FCF) Q+A | `/stocks/{sym}/financials/cash-flow-statement/?p=quarterly\|annual` | same |
| Company profile | `/stocks/{sym}/company/` | `api/live.js` profile panel |
| Shares float + short interest | `/stocks/{sym}/statistics/` | `09f_short_interest.py` |
| Analyst estimates | `/stocks/{sym}/forecast/` | AI analysis enrich |
| Earnings calendar | `/calendar/earnings/{YYYY-MM-DD}/` | `09g_earnings_calendar.py` |
| Margins / ratios | `/stocks/{sym}/financials/ratios/` | `09f_margins.py` |

**Ranked sources for each gap:**

1. **stockanalysis.com** — primary. Scrape from pipeline (never Vercel).
2. **SEC EDGAR XBRL** (`https://data.sec.gov/api/xbrl/companyconcept/...`)
   — fallback when stockanalysis is stale or missing a ticker, plus for 13F.
3. **Nasdaq API** (`https://api.nasdaq.com/api/calendar/earnings?date=...`)
   — alternative earnings calendar, less fragile than scraping.
4. **FINRA short-sale CSVs** — for bi-monthly regulatory short interest if
   stockanalysis's number drifts.
5. **Minimal paid FMP plan** ($14/mo Starter) — only if scraping proves too
   fragile for production. Keep as emergency fallback.

**Architectural rules:**

- **Pipeline-only scraping.** Cloudflare blocks Vercel datacenter IPs. All
  scraping runs on your Mac (cron) or GitHub Actions. Results land in
  `dashboard_data.json` and `public/data/fundamentals.json`.
- **Aggressive caching.** Fundamentals change quarterly; profile changes
  almost never. Cache 24h+ on disk. Only earnings calendar needs daily refresh.
- **Rate-limit, don't parallelize.** 1 req/s, no more. Use a shared token
  bucket if multiple scripts scrape concurrently.
- **User-Agent identifies us.** `ThemePulse-Research/1.0 (+nprabhak2018@gmail.com)`
  — good-faith scraping, courtesy to the site.
- **HTML parse = fragility.** Ship with a daily canary that fetches one known
  ticker (AAPL) and validates the parse. Alert via Pushover if shape changes.

### Earnings calendar

Used in: pipeline `09g_earnings_calendar.py`, `09_export_web_data.py`.

**Primary: stockanalysis.com** (`/calendar/earnings/{YYYY-MM-DD}/`).
**Fallback: Nasdaq API** (`https://api.nasdaq.com/api/calendar/earnings?date=YYYY-MM-DD`).

Pipeline scrapes both, reconciles, caches to `earnings_calendar.json`.

### Institutional ownership

stockanalysis has summary %s only (top 10 holders). For full 13F detail:
**SEC EDGAR 13F filings** — quarterly, 45-day lag. Use `sec-edgar-downloader`
Python lib in pipeline. Only run if AI analysis actually uses it; currently
low signal.

### Short interest, shares-float

stockanalysis.com `/statistics/` has both. **Primary source.** FINRA CSV
fallback only if stockanalysis's numbers drift from official bi-monthly
regulatory data.

### Company profile

stockanalysis.com `/company/` has sector, industry, description, employees,
CEO, HQ, website, exchange — everything `api/live.js` currently reads from
FMP `/profile`. Direct replacement.

---

## 4. Infrastructure changes

### Token sync (Vercel serverless ↔ Schwab OAuth)

Problem: Schwab refresh tokens are 7-day, access tokens 30-min. Vercel edge
functions can't persist state across invocations.

**Plan:**

1. Local daemon: `~/Claude Theme/themepulse/scripts/schwab/token_daemon.py`
   - Runs every 20 min (launchd plist or cron)
   - Loads token from `~/.themepulse/schwab_token.json`
   - If access token <5min from expiry, refreshes it
   - Pushes access token to Vercel KV under key `schwab:access_token` + TTL 30min
2. New helper `api/_schwab.js`:
   - Reads access token from KV
   - If missing/stale, returns `null` — caller falls back to FMP during
     transition window
3. Refresh-token expiry alert:
   - Daemon checks if refresh token is <24h from 7-day expiry
   - If so, pushes a Pushover/Signal alert to rerun `bootstrap.py`

### Env vars (Vercel)

- Add: `SCHWAB_CLIENT_ID`, `SCHWAB_CLIENT_SECRET` (for token refresh endpoint
  if we do it server-side — probably NOT needed if daemon handles refresh)
- Keep `FMP_API_KEY` during transition, remove at end of phase 5

### Vercel KV keys

- `schwab:access_token` (string, TTL 1800s) — current access token
- `schwab:last_refresh` (string, ISO) — daemon heartbeat
- `schwab:refresh_expires_at` (string, ISO) — for alert thresholding

---

## 5. Phased rollout

**Phase 0 — prereqs (manual, blocks everything):**
- [ ] Register app at developer.schwab.com, select MarketData Production
- [ ] Wait 1-3 business days for approval
- [ ] Export `SCHWAB_CLIENT_ID` + `SCHWAB_CLIENT_SECRET` in shell
- [ ] Run `bootstrap.py`, verify `test_quotes.py` / `test_options.py` /
      `test_ohlc.py` work

**Phase 1 — low-risk: OHLC (`api/ohlc.js`)**
- Swap `FMP_BASE/historical-chart/*` and `/historical-price-eod/full` for
  Schwab equivalents. Preserve JSON response shape so App.jsx keeps working.
- Deploy, validate on the LWChart component for 5-10 tickers.
- **Rollback:** keep FMP code path behind `if (!schwabToken)` fallback.

**Phase 2 — live quotes (`api/live.js` universe + watchlist)**
- Build Vercel KV token reader.
- Add Schwab batch-quote path, field-by-field match FMP quote shape.
- Gate behind `USE_SCHWAB_QUOTES=1` env var for A/B testing.
- Validate: price parity, dayHigh/dayLow (used for ORH capture), yearHigh/
  yearLow (used for H/L bars), volume, pre/post-market fields.
- Flip the env flag to `1` after 24h of parity checks.

**Phase 3 — scan-scores + market-quality**
- Mechanical swap, same quote-shape mapping.
- Includes `$VIX.X` / `$TNX.X` symbol translation.

**Phase 4 — pipeline (Python)**
- Port `01_fmp_extract.py` quote logic to Schwab via `schwab-py`.
- `09e_vcs.py`, `09k_premarket_briefing.py`, `09g_macro_context.py` — direct
  swap to `price_history_*` or `get_quotes`.
- Pipeline uses its own OAuth cache (separate from ThemePulse daemon to avoid
  contention) — `~/.themepulse/schwab_token_pipeline.json`. Or share the same
  file with a file-lock.

**Phase 5 — fundamentals (stockanalysis-centric)**
- Build `stockanalysis_scraper.py` module (shared by pipeline scripts).
- Rewrite `09c_earnings_enrich.py` to scrape income statement + cash flow.
- Rewrite `09f_short_interest.py`, `09f_margins.py` to use same scraper.
- Rewrite `09g_earnings_calendar.py` to use stockanalysis + Nasdaq fallback.
- Bake results into `public/data/fundamentals.json` + `dashboard_data.json`.
- Remove `fetchFinancialsFmp` from `api/live.js` — frontend reads the JSON
  file instead.
- Add daily canary job that validates scraper shape against AAPL.
- Remove `FMP_API_KEY` from Vercel env.

**Phase 6 — decommission**
- Delete FMP fallback code paths.
- Remove FMP references from `CLAUDE.md`, `update.sh`.
- Cancel FMP subscription.

---

## 6. Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Schwab app rejection or delayed approval | Med | Blocks everything | Nothing to do but wait |
| 7-day refresh token lapses unattended | High | Quotes go dark | Pushover alert when <24h remains |
| Schwab rate limit (120/min) too tight during scan | Low | Some requests 429 | Chunk universe quotes; Schwab allows ~500 syms/call so 120 calls ≈ 60k tickers/min |
| Quote field-shape mismatch | Med | Frontend rendering bugs | Shim layer in each api/* file, not in App.jsx |
| Fundamentals migration drags on | High | Stuck paying FMP | Start Phase 5 in parallel with Phase 2 |
| Schwab symbol mismatch (`VIX` vs `$VIX.X`, `BRK.B` vs `BRK/B`) | Med | Missing data | `symbol_map.js` utility, test during bootstrap |
| Pipeline + frontend token file contention | Low | Refresh-token race | Use file lock or two token files |

---

## 7. Files that will change (complete list)

**ThemePulse (this repo):**
- `api/live.js` — large rewrite of quote + financial fetchers
- `api/ohlc.js` — rewrite both code paths
- `api/scan-scores.js` — rewrite `fetchFmpQuotes`
- `api/market-quality.js` — rewrite `fetchQuotes`, index quote paths
- `api/analyze-ticker.js` — inspect, rewrite likely
- `api/_schwab.js` **(new)** — shared KV token reader + quote helper
- `scripts/schwab/token_daemon.py` **(new)** — periodic refresh + KV push
- `scripts/schwab/symbol_map.js` **(new)** — FMP↔Schwab symbol translation
- `CLAUDE.md` — update "Real-time FMP batch quotes" → Schwab
- `update.sh` — adjust any env-var checks

**Stock-pipeline (separate repo):**
- `scripts/01_fmp_extract.py` → rename `01_schwab_extract.py`
- `scripts/09c_earnings_enrich.py` → SEC EDGAR
- `scripts/09e_vcs.py`, `09g_macro_context.py`, `09k_premarket_briefing.py` → Schwab
- `scripts/09f_*.py` → SEC EDGAR / scrape
- `scripts/09g_earnings_calendar.py` → Nasdaq API
- `scripts/09r_rvol_catalyst_scan.py` → partial
- `scripts/ep_backtest.py` → Schwab
- `run.sh` — env-var rename
- `.github/workflows/*.yml` — secret name changes
- `CLAUDE.md` — update data-source section

---

## 8. Estimated effort

- Phase 1: 1-2 hours
- Phase 2: 3-4 hours (token daemon + field mapping + A/B gate)
- Phase 3: 1 hour
- Phase 4: 3-5 hours (pipeline is bigger surface)
- Phase 5: 6-10 hours (SEC EDGAR is fiddly)
- Phase 6: 30 min

**Total: ~15-22 hours** of focused work, spread across a few sessions.
Realistically a week elapsed once the Schwab app is approved.
