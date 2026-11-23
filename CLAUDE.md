# ThemePulse Frontend

## Overview
Vite + React 18 single-page dashboard for CAN SLIM / momentum growth stock research, deployed on Vercel at `themepulse.vercel.app`. Visualizations are pure CSS + inline SVG (no charting library dependency).

## Repos
- **Frontend**: `tintinsharks/themepulse` (this repo)
- **Pipeline**: `tintinsharks/stock-pipeline` (Python pipeline pushing `public/dashboard_data.json` and `public/data/*.json` via GitHub Actions)

## Architecture
- **Root app**: `src/App.jsx` (~3,150 lines) — theme context (Aria dark/light + zoom), pipeline data loading, quote manager (`useLiveQuotes`), userdata sync (`useServerState`), `ChartPanelInline` + `DailyChartSVG` + `EarningsBox`, trade alerts, and topbar navigation.
- **Primary views**: Three views switched via topbar (`LEADERS`, `SCANNER`, `BRIEF`), orchestrated by `src/LeadershipView.jsx`:
  - `src/lead/math.js` — Pure JSX-free ranking, classification, ZVR, tier, EPS, and RS math (unit-tested in `test/leadMath.test.js`).
  - `src/lead/core.jsx` — Shared data hooks (`useJson` with in-memory/in-flight cache), market gate, index panel, themes/layers boards, stock tables, intraday scan, extended-hours movers, ticker flags.
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

Vercel Serverless Functions (api/) — 6 functions (6 free slots under Vercel Hobby's 12-function cap):
  - api/auth.js           — GET status check + POST PIN → 30-day HMAC Bearer token (requires TP_PIN + TP_SESSION_SECRET)
  - api/live.js           — Real-time quotes + news/fundamentals (Finviz Elite / FMP, Bearer-gated)
  - api/ohlc.js           — Historical daily/weekly OHLC bars (FMP, Bearer-gated)
  - api/earnings.js       — Per-ticker earnings history/estimates (Bearer-gated)
  - api/userdata.js       — Upstash Redis persistence (Bearer-gated GET/POST; RVOL_SCANNER_TOKEN for pm-movers/ah-movers POST)
  - api/market-quality.js — Market Quality Terminal scoring (used by public/terminal.html, Bearer-gated)
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
