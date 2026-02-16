#!/bin/bash
# update.sh - Refresh data and deploy to Vercel
set -e

echo "=== ThemePulse Update ==="

# Run the stock pipeline
cd ~/stock-pipeline
source venv/bin/activate

echo "1. Pulling Finviz data..."
python3 -u scripts/01_finviz_extract.py

echo "2. Running analysis..."
python3 -u scripts/03_analyze.py

echo "3. Exporting web data..."
python3 -u scripts/09_export_web_data.py

echo "3b. Enriching stock details..."
python3 -u scripts/09b_enrich_web_data.py

echo "3c. Enriching YoY earnings (FMP)..."
python3 -u scripts/09c_earnings_enrich.py || echo "   (skipped — FMP_API_KEY not set or API error)"

echo "4. Building Excel dashboard..."
python3 -u scripts/07_combined_dashboard.py

echo "5. Running Market Monitor..."
python3 -u scripts/10_market_monitor.py

# Copy data to web app
echo "6. Copying data to ThemePulse..."
cp ~/stock-pipeline/output/dashboard_data.json ~/themepulse/public/
cp ~/stock-pipeline/output/market_monitor.json ~/themepulse/public/

# Deploy
echo "7. Deploying..."
cd ~/themepulse
git add -A
git commit -m "data update $(date +%Y-%m-%d)" 2>/dev/null || echo "No changes to commit"
git push

echo ""
echo "=== Done! Dashboard updated. ==="
echo "Excel: ~/stock-pipeline/output/Combined_Dashboard_$(date +%Y-%m-%d).xlsx"
