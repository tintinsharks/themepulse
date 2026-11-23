---
name: zanger-scan
description: Run ThemePulse's Leading Stocks in Leading Themes and Dan Zanger intraday volume movers scan, enrich top setups with catalysts, and save a markdown briefing to reports/.
---

# ThemePulse Zanger & Leadership Scan

Use this skill whenever the user asks to find **leading stocks in leading themes**, **intraday volume movers**, or **Dan Zanger breakout setups** in ThemePulse.

## Procedure

1. **Run the deterministic scanner** from the ThemePulse repository root (`/Users/nprabhak/Claude Theme/themepulse`):
   ```bash
   node scripts/zanger-scan.mjs
   ```
   - This reads `public/dashboard_data.json` + `public/data/*.json` using ThemePulse's pure scoring math (`src/lead/math.js`), authenticates to `https://themepulse.vercel.app/api/auth` when `TP_PIN` is set in env or `.env.local`, pulls live quotes via `/api/live?universe=...`, and fetches live headlines for top movers.
   - If `TP_PIN` is unavailable or network is offline, it automatically falls back to pipeline EOD data and labels the report accordingly.
   - It writes the timestamped briefing to `reports/zanger-YYYY-MM-DD-HHMM-ET.md` and updates `reports/latest.md`.

2. **Review & enrich the top setups**:
   - Inspect `reports/latest.md` and highlight:
     - **Dan Zanger Breakouts (`🔥 BO`)**: ZVR ≥ 2.0x normal pace for this minute of the session, green ≥ +3%, strong Closing Range (CR ≥ 70%), within 10% of 52-week high, RS ≥ 75, above 50d MA, $20M+ avg dollar volume, in a leading/emerging theme layer (or RS 90+ leader).
     - **Volume Surges (`⚡ VOL`) & RS-Line Leaders (`🔵 RSL`)**: ZVR ≥ 1.5x, green ≥ +1.5%, CR ≥ 60%, within 20% of 52-week high.
     - **Theme Leadership Health**: Flag any leading layers showing `distrib` or `exiting` warnings so the user avoids chasing weakening groups.
   - If any top mover has no live headline in the report and web search is available, do a quick catalyst lookup (`<TICKER> stock news today`) and append a concise **Catalyst & Setup Commentary** section to the saved report (`reports/zanger-*.md` and `reports/latest.md`).

3. **Present a concise trading desk summary**:
   - Lead with the top 3–5 highest-conviction Dan Zanger setups (ticker, theme/layer, price/chg, ZVR, CR%, RS/EPS, off-52w-high, and catalyst).
   - Call out the top leading themes (noting any distribution/exit warnings).
   - Link directly to the saved report file in `reports/`.
