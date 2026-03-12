# ThemePulse Frontend

## Overview
Vite + React single-page dashboard for growth stock research. Deployed on Vercel at themepulse.vercel.app. All rendering is in one monolithic `src/App.jsx` (~8,800 lines). No chart libraries — all visualizations are pure CSS + inline SVG.

## Repos
- **Frontend**: `tintinsharks/themepulse` (this repo)
- **Pipeline**: `tintinsharks/stock-pipeline` (Python pipeline, builds `dashboard_data.json` via GitHub Actions)

## Architecture
- **Single-file app**: `src/App.jsx` contains all components (~20 functions, no separate component files)
- **Lazy-loaded**: `USMarketQuadrant.jsx` is the only code-split module
- **Data**: Fetches `dashboard_data.json` (pipeline output) + `data/ai_analysis.json` + `data/earnings_intel.json` from `public/`
- **Serverless API**: `api/` directory — Vercel Edge Functions for auth, live quotes, OHLC, user data
- **Styling**: 100% inline styles, no CSS files. Dark theme: `#121218` bg, `#0d9163` green accent, `#22d3ee` cyan for Earnings Intel
- **Auth**: Simple token-based via `api/auth.js`, stored in localStorage

## Nav Tabs & Components

| Tab | Component | Line | Description |
|-----|-----------|------|-------------|
| Live | `LiveView` | 6800 | Portfolio/watchlist with morning briefing, live quotes |
| PKN | `PknView` | 6625 | Pradeep/Kumar/Nitin shared focus lists |
| Scan Watch | `Scan` | 1436 | Main screener: Leaders + EP + Short Scan + Theme drill-down |
| Research | `Grid` | 3819 | Full stock grid with sortable columns |
| Execution | `Execution` | 5477 | Trade journal with entry/stop/target tracking |
| Performance | `TradePerformance` | 7316 | P&L analytics, win rate, R-multiple distribution |
| Quadrant | `USMarketQuadrant` | (lazy) | Market breadth regime visualization |
| Earnings Intel | `EarningsIntel` | 7870 | Quarterly S&P 500 earnings themes/sentiment/signals |

Sub-components inside Scan Watch:
- `Leaders` (line 976) — Theme-based stock screening with RS/TS grades
- `EpisodicPivots` (line 2552) — EP/Earnings/SIP movers unified table
- Short Scan — Short-selling candidates (inside Scan)

## Key Shared Components

| Component | Line | Purpose |
|-----------|------|---------|
| `ChartPanel` | 374 | Right-side chart panel with TradingView + LW charts, catalyst notes |
| `IntradayChart` | 4332 | SVG intraday price chart |
| `LWChart` | 4703 | Lightweight multi-timeframe OHLC chart |
| `TabbedAnalysis` | 262 | AI analysis reader (5 tabs: takeaways, revenue, margins, thesis, risks) |
| `SimpleMarkdown` | 169 | Lightweight markdown renderer (headers, bold, italic, bullets, tables) |
| `ErrorBoundary` | 5 | React error boundary wrapping each view |
| `PipelineStatus` | 7784 | Pipeline run metadata display |

## Data Flow
```
stock-pipeline (GitHub Actions)
  → dashboard_data.json (pushed to public/)
  → Vercel serves static JSON

Claude Cowork (scheduled sessions)
  → reads /api/ai-queue for ticker list
  → ai_analysis.json (pushed via git)
  → earnings_intel.json (pushed via git)

api/live.js (Vercel Edge)
  → Real-time quotes from FMP /stable/batch-quote
```

## AI-Powered Features

### AI Analysis (`scripts/run-ai-analysis.sh`) — via Cowork
- Reads ticker queue from `GET /api/ai-queue` (manually added by user in Scan > AI Analysis tab)
- Full research mode (WebSearch + WebFetch stockanalysis.com) or incremental price-action update
- Output: `public/data/ai_analysis.json` → `TabbedAnalysis` component in ChartPanel
- **Cowork schedule**: Every 60 min, weekdays 8 AM–5 PM ET
- **Cowork prompt**: `scripts/ai-analysis-prompt.md` (full) or `scripts/ai-analysis-update-prompt.md` (incremental)

### Earnings Intelligence (`scripts/run-earnings-intel.sh`) — via Cowork
- Researches all 11 GICS sectors via WebSearch/WebFetch
- Synthesizes cross-sector themes, momentum signals, executive quotes
- Output: `public/data/earnings_intel.json` → `EarningsIntel` component
- **Cowork schedule**: Once quarterly (Feb 15, May 15, Aug 15, Nov 15)
- **Cowork prompt**: `scripts/earnings-intel-prompt.md`

### AI Queue API
- `GET /api/ai-queue` — Public endpoint returning `{ aiQueue: [...], updated: "..." }` from Upstash Redis
- Queue is populated by user in Scan > AI Analysis tab (persisted via `api/userdata.js` to Upstash)
- Cowork reads this to know which tickers to analyze

## Trading System Context
This dashboard supports a **CAN SLIM / momentum breakout** style:
- **RS/TS rankings**: Relative Strength + Trend Strength composite grades (A+ through G)
- **Theme-based**: Stocks grouped by sector themes (AI, Cybersecurity, GLP-1, etc.)
- **Episodic Pivots**: Gap+volume+range breakout scanner (Pradeep Bonde method)
- **Chart Patterns**: VCP, Cup & Handle, Flat Base, Power Play, Ascending Base, Double Bottom, HTF, IPO Base, Symmetrical Triangle
- **Momentum Burst**: Stockbee +4% breakout scan
- **Key metrics**: ADR%, distance from moving averages in ATR multiples, float, dollar volume

## Serverless API (`api/`)

| File | Purpose |
|------|---------|
| `auth.js` | Token validation |
| `live.js` | Real-time FMP batch quotes (called by LiveView every 30s during market hours) |
| `ohlc.js` | Historical OHLC for LWChart |
| `userdata.js` | Persist portfolio/watchlist/trades to Vercel KV |
| `catalyst-summary.js` | AI catalyst summaries |

## Commands
```bash
# Dev server
npm run dev

# Production build
npx vite build

# Deploy (auto on push to main)
git push

# AI analysis (manual — or let Cowork run it)
./scripts/run-ai-analysis.sh --dry

# Earnings intel (manual — or let Cowork run it)
./scripts/run-earnings-intel.sh --dry

# Check AI queue
curl -s https://themepulse.vercel.app/api/ai-queue | python3 -m json.tool
```

## Key Patterns
- **All components are functions** inside App.jsx (no class components except ErrorBoundary)
- **State lives in AppMain** (~line 8187) and is passed down as props
- **stockMap**: `useMemo` keyed by ticker for O(1) lookups — most components receive this
- **openChart/closeChart**: Shared chart panel pattern — right-side split view with draggable divider
- **onVisibleTickers**: Components report visible tickers for chart panel scrolling sync
- **Grade colors**: `GRADE_COLORS` constant maps A+ through G to green→red gradient
- **Inline styles everywhere**: No CSS classes except a few injected via `useEffect` for responsive breakpoints
- **localStorage**: Trades, portfolio, watchlist, chart notes, account size all persisted locally + synced via `api/userdata.js`
