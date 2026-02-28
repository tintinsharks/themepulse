#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# ThemePulse Daily Update — v04 (Streamlined)
# Run after market close (~4:30 PM ET)
#
# Usage:
#   cd ~/themepulse && ./update.sh
#
# What it does:
#   1. Scrape Finviz (Overview, Valuation, Financial, Performance, Technical)
#   2. Analyze: RS rankings, grades, theme scoring
#   3. Export dashboard JSON
#   4. Enrich: fundamentals from Finviz CSV (local, fast)
#   5. Episodic Pivot scan
#   6. Theme health scoring (ADD/REMOVE signals)
#   7. Scrape TheStockCatalyst (earnings movers + headlines + session data)
#   8. Market Monitor (breadth, 4% movers, theme sparklines, index MA)
#   9. Copy JSONs to web app + git push to deploy
#
# Removed from v03: 09g (slow FMP/Nasdaq APIs), 09i (momentum burst),
#                    07 (Excel dashboard — not needed for web)
# ═══════════════════════════════════════════════════════════════

set -e  # Exit on any error
ulimit -n 4096  # Increase file handle limit for EP scanner

PIPELINE="$HOME/Claude Theme/stock-pipeline"
WEBAPP="$HOME/themepulse"
SCRIPTS="$PIPELINE/scripts"
OUTPUT="$PIPELINE/output"
PUBLIC="$WEBAPP/public"

START_TIME=$(date +%s)

echo "═══════════════════════════════════════════════════════════"
echo "  THEMEPULSE DAILY UPDATE — $(date '+%Y-%m-%d %H:%M')"
echo "═══════════════════════════════════════════════════════════"

# Activate virtual environment
cd "$PIPELINE"
source venv/bin/activate

# ── Step 1: Scrape Finviz ──────────────────────────────────────
echo ""
echo "▶ [1/8] Finviz Extract (5 views)"
python3 -u "$SCRIPTS/01_finviz_extract.py"

# ── Step 2: Analyze ────────────────────────────────────────────
echo ""
echo "▶ [2/8] Analyze (RS rankings, grades, themes)"
python3 -u "$SCRIPTS/03_analyze.py"

# ── Step 3: Export Dashboard JSON ──────────────────────────────
echo ""
echo "▶ [3/8] Export Web Data"
python3 -u "$SCRIPTS/09_export_web_data.py"

# ── Step 4: Enrich ─────────────────────────────────────────────
echo ""
echo "▶ [4/8] Enrich (fundamentals from Finviz CSV)"
python3 -u "$SCRIPTS/09b_enrich_web_data.py"

# ── Step 5: Episodic Pivots ────────────────────────────────────
echo ""
echo "▶ [5/8] Episodic Pivot Scan"
python3 -u "$SCRIPTS/09d_episodic_pivots.py"

# ── Step 6: Theme Health ───────────────────────────────────────
echo ""
echo "▶ [6/8] Theme Health Scoring"
python3 -u "$SCRIPTS/09e_theme_health.py"

# ── Step 7: Scrape TheStockCatalyst ────────────────────────────
echo ""
echo "▶ [7/8] Earnings Movers + Headlines (TheStockCatalyst)"
python3 -u "$SCRIPTS/09h_scrape_headlines.py"

# ── Step 8: Market Monitor ─────────────────────────────────────
echo ""
echo "▶ [8/8] Market Monitor (breadth, indices, theme sparklines)"
python3 -u "$SCRIPTS/10_market_monitor.py"

# ── Copy JSONs to web app ──────────────────────────────────────
echo ""
echo "▶ Copying JSONs to $PUBLIC/"
cp "$OUTPUT/dashboard_data.json" "$PUBLIC/dashboard_data.json"
cp "$OUTPUT/market_monitor.json" "$PUBLIC/market_monitor.json"
echo "  ✅ dashboard_data.json"
echo "  ✅ market_monitor.json"

# ── Deploy ─────────────────────────────────────────────────────
echo ""
echo "▶ Deploying to Vercel..."
cd "$WEBAPP"
git add -A
git commit -m "Daily update $(date '+%Y-%m-%d')" || echo "  (no changes to commit)"
git push

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))
MINS=$((ELAPSED / 60))
SECS=$((ELAPSED % 60))

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  ✅ THEMEPULSE UPDATE COMPLETE — ${MINS}m ${SECS}s"
echo "═══════════════════════════════════════════════════════════"
