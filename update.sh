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

echo "4. Building Excel dashboard..."
python3 -u scripts/07_combined_dashboard.py

# Copy data to web app
echo "5. Copying data to ThemePulse..."
cp ~/stock-pipeline/output/dashboard_data.json ~/themepulse/public/

# Deploy
echo "6. Deploying..."
cd ~/themepulse
git add -A
git commit -m "data update $(date +%Y-%m-%d)" 2>/dev/null || echo "No changes to commit"
git push

echo ""
echo "=== Done! Dashboard updated. ==="
echo "Excel: ~/stock-pipeline/output/Combined_Dashboard_$(date +%Y-%m-%d).xlsx"
