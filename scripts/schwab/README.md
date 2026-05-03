# Schwab API Integration (ThemePulse)

Replaces FMP for live quotes, options chains, and OHLC. Free if you have a Schwab brokerage account.

## One-time setup

### 1. Register an app at developer.schwab.com

1. Go to https://developer.schwab.com → **Dashboard** → **Create App**.
2. Pick **Individual Developer**.
3. APIs: select **Market Data Production** and **Accounts and Trading Production**.
4. **Callback URL**: `https://127.0.0.1:8182`
5. Submit. Approval takes **1–3 business days**. You'll get an email.
6. Once approved, copy the **App Key** (= Client ID) and **Secret** from the dashboard.

### 2. Export credentials in your shell

Add to `~/.zshrc` (or wherever — these are secrets, don't commit them):

```bash
export SCHWAB_CLIENT_ID="your-app-key"
export SCHWAB_CLIENT_SECRET="your-app-secret"
export SCHWAB_CALLBACK_URL="https://127.0.0.1:8182"
```

Then `source ~/.zshrc`.

### 3. Run the one-time OAuth bootstrap

```bash
cd "/Users/nprabhak/Claude Theme/themepulse/scripts/schwab"
python3 bootstrap.py
```

A browser opens → log in to Schwab → approve → you get redirected to
`https://127.0.0.1:8182/...` which **will show a cert warning** (fine, click
through) and **will fail to load** (also fine — schwab-py is listening on that
URL and captures the code).

The token is saved to `~/.themepulse/schwab_token.json`. Refresh token lasts
**7 days** — the library auto-refreshes the short-lived access token on every
call. You'll need to re-run `bootstrap.py` once a week until Schwab allows
longer-lived refresh tokens (they've talked about 90-day ones).

## Smoke tests

```bash
python3 test_quotes.py NVDA AMD SPY QQQ
python3 test_options.py NVDA 10
python3 test_ohlc.py NVDA 5m
python3 test_ohlc.py NVDA 1d
```

## What this replaces in ThemePulse

| Current FMP endpoint | Schwab replacement |
|---|---|
| `GET /stable/batch-quote` | `client.get_quotes(syms)` — up to ~500 symbols per call |
| `GET /stable/historical-chart/5min` | `client.get_price_history_every_five_minutes(sym)` |
| `GET /stable/historical-price-eod/full` | `client.get_price_history_every_day(sym)` |
| `GET /stable/income-statement` | **Not available** — keep FMP or scrape stockanalysis.com |
| `GET /stable/cash-flow-statement` | **Not available** — same |
| `GET /stable/profile` | Partial — some fields via `get_quote` fundamentals; rest needs alt source |

**New capability** (not in FMP at current tier): full options chains with
Greeks, bid/ask, OI, IV — `client.get_option_chain(sym)`.

## Token sync to Vercel (deferred)

Vercel serverless can't keep a long-lived refresh token hot. Plan when we
wire up `api/live.js`:

- Local cron refreshes the token every ~25 min, pushes the *access token*
  (short-lived, safe-ish) to Vercel KV under key `schwab:access_token`.
- `api/live.js` reads that key and calls Schwab directly.
- If the KV key is stale/missing, fall back to FMP (keep both keys for now).

See `sync_to_kv.py` — not written yet; build once bootstrap is working.

## Gotchas

- **schwab-py auth uses Selenium** by default for the login flow. If it hangs
  on the browser step, you may need `pip3 install --user --upgrade selenium`.
- **Tokens expire after 7 days.** No way around it yet — just re-bootstrap.
- **Rate limits**: 120 req/min per app. Plenty for ThemePulse unless you're
  polling 500 symbols at <1s intervals.
- **Equity-only app vs full**: make sure you picked *Market Data Production*
  during registration, not just Individual Developer. The dashboard shows
  which APIs your app has access to.
