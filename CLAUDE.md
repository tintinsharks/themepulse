# ThemePulse Frontend

## Overview
Vite + React 18 single-page dashboard for CAN SLIM / momentum growth stock research, deployed on Vercel at `themepulse.vercel.app`. Visualizations are pure CSS + inline SVG (no charting library dependency).

## Repos
- **Frontend**: `tintinsharks/themepulse` (this repo)
- **Pipeline**: `tintinsharks/stock-pipeline` (Python pipeline pushing `public/dashboard_data.json` and `public/data/*.json` via GitHub Actions)

## Architecture
- **Root app**: `src/App.jsx` (~3,150 lines) — theme context (Aria dark/light + zoom), pipeline data loading, quote manager (`useLiveQuotes`), userdata sync (`useServerState`), `ChartPanelInline` + `DailyChartSVG` + `EarningsBox`, trade alerts, and topbar navigation.
- **Primary views**: Three views switched via topbar (`LEADERS`, `SCANNER`, `BRIEF`), orchestrated by `src/LeadershipView.jsx`:
  - `src/lead/core.jsx` — Shared market gate, index panel, themes/layers boards, stock tables, intraday scan, extended-hours movers, ticker flags, tier/EPS/live-RS calculations.
  - `src/lead/Scanner.jsx` (lazy-loaded) — Live scanner view.
  - `src/lead/Brief.jsx` (lazy-loaded) — Daily PM/AM brief view.
  - `src/lead/Rotation.jsx` (lazy-loaded) — Subtheme/layer rotation view.
- **Shared modules**:
  - `src/styles.js` — `ARIA_DARK` / `ARIA_LIGHT` palettes and shared style primitives.
  - `src/utils.js` — ET clock helper, `GRADE_COLORS`, U-shaped volume curve (`_cumVolFrac`, `projectedRVol`), quadrant helpers.
  - `src/wheelTrades.js` — Pure Schwab Realized Gain/Loss CSV parser, trade merge/tombstone logic, and wheel cost-basis math.
  - `src/indicators.js` — Pure Wilder RSI, EMA, MACD, reversal signal detection, and forward-return study helpers.
- **Styling**: 100% inline styles with `ARIA_DARK` / `ARIA_LIGHT` React context (`useAriaTheme()`).

## Data & Caching Flow
```
stock-pipeline (GitHub Actions)
  → public/dashboard_data.json + public/data/*.json
  → Vercel serves static JSON with Cache-Control: public, max-age=60, stale-while-revalidate=300
  → Frontend fetches static JSON with { cache: "no-cache" } (ETag/304 revalidation)

Vercel Serverless Functions (api/) — 12 functions (Vercel Hobby cap):
  - api/live.js            — Real-time quotes + news/fundamentals (Finviz Elite / FMP)
  - api/ohlc.js            — Historical daily/weekly OHLC bars (FMP)
  - api/earnings.js        — Per-ticker earnings history/estimates
  - api/userdata.js        — Upstash Redis persistence (watchlist/portfolio/wheelTrades + ?scope=flags|pm-movers|ah-movers)
  - api/zvr.js             — Zanger Volume Ratio + setup journal queries
  - api/market-quality.js  — Market Quality Terminal scoring (used by public/terminal.html)
  - api/scan-scores.js     — Pre-computed EPS/C&A/MS scan scores
  - api/analyze-ticker.js  — On-demand 4-agent ticker analysis
  - api/theme-analysis.js  — EOD theme analysis storage (Upstash, x-api-key gated)
  - api/wheel.js           — Schwab options chain wheel screener
  - api/schwab-callback.js — Schwab OAuth callback handler
  - api/auth.js            — PIN → HMAC token auth (requires TP_PIN + TP_SESSION_SECRET)
```

## Commands
```bash
# Dev server (proxies /api/* to https://themepulse.vercel.app)
npm run dev

# Lint (no-undef, react-hooks/rules-of-hooks, exhaustive-deps, no-unused-vars)
npm run lint

# Unit tests (Node built-in test runner, zero extra deps)
npm test

# Production build (runs lint + Vite build)
npm run build
```

## Key Patterns
- **State & Persistence**: Pipeline data loads once via `useDashboardData()` and refreshes every 30 min during pipeline windows. User lists sync via `/api/userdata` with localStorage offline cache; ticker flags sync via `/api/userdata?scope=flags`.
- **Error Boundaries**: `ErrorBoundary` wraps both `AppMain` and `LeadershipView` and surfaces the failing component name (preserved in prod via `esbuild.keepNames: true` in `vite.config.js`).
- **Lint Guardrails**: `eslint.config.js` enforces `no-undef` and `react-hooks/rules-of-hooks` as errors, plus `react-hooks/exhaustive-deps` and `no-unused-vars` as warnings.
