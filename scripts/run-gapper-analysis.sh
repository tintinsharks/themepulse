#!/bin/bash
# ─────────────────────────────────────────────────────────
# ThemePulse Gapper Analysis — Claude Code runner
#
# Identifies today's gappers from dashboard_data.json,
# researches catalysts, and generates analysis JSON.
#
# Usage:
#   ./scripts/run-gapper-analysis.sh          # full run (research + write + push)
#   ./scripts/run-gapper-analysis.sh --dry    # generate JSON but skip git push
#
# Prerequisites:
#   - claude CLI installed and authenticated
#   - Run from the themepulse repo root (~/themepulse)
# ─────────────────────────────────────────────────────────

set -euo pipefail

# ── Ensure nvm node/claude are on PATH (needed for launchd + non-interactive shells) ──
export PATH="$HOME/.nvm/versions/node/v20.20.0/bin:/opt/homebrew/bin:$PATH"

# ── Weekday guard — skip on Saturday/Sunday ──
DOW=$(date +%u)  # 1=Mon … 7=Sun
if [[ "$DOW" -ge 6 ]]; then
  echo "📅 Weekend (day $DOW) — skipping gapper analysis."
  exit 0
fi

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROMPT_FILE="$REPO_DIR/scripts/gapper-analysis-prompt.md"
OUTPUT_FILE="$REPO_DIR/public/data/gapper_analysis.json"
DRY_RUN=false

if [[ "${1:-}" == "--dry" ]]; then
  DRY_RUN=true
  echo "🧪 Dry run — will generate JSON but skip git push"
fi

# ── Preflight checks ──
if ! command -v claude &>/dev/null; then
  echo "❌ claude CLI not found. Install: https://docs.anthropic.com/en/docs/claude-code"
  exit 1
fi

if [[ ! -f "$REPO_DIR/public/dashboard_data.json" ]]; then
  echo "❌ dashboard_data.json not found. Run from themepulse repo root."
  exit 1
fi

if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "❌ Prompt file not found at $PROMPT_FILE"
  exit 1
fi

# ── Pull latest before running ──
cd "$REPO_DIR"
git stash --quiet 2>/dev/null
git pull --rebase origin main || echo "⚠️  git pull failed — continuing with local state"
git stash pop --quiet 2>/dev/null || true

# ── Count qualifying gappers (quick preview) ──
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "🕐 Starting gapper analysis at $NOW"

PASSING=$(python3 -c "
import json
with open('$REPO_DIR/public/dashboard_data.json') as f:
    d = json.load(f)
stocks = [s for s in d.get('stocks', [])
    if s.get('change_pct', 0) > 0
    and s.get('change_pct', 0) >= 4
    and s.get('rel_volume', 0) >= 2.0
    and s.get('market_cap_raw', 0) >= 300000000
    and s.get('avg_dollar_vol_raw', 0) >= 50000000]
for s in sorted(stocks, key=lambda x: -x.get('change_pct', 0)):
    print(f\"  {s['ticker']:6s} chg={s['change_pct']:+.1f}%  rv={s.get('rel_volume',0):.1f}x  rs={s.get('rs_rank','?')}  mc={s.get('market_cap','?')}\")
print(f'---')
print(f'{len(stocks)} gappers qualify')
" 2>/dev/null || echo "0 gappers qualify")
echo "$PASSING"

COUNT=$(echo "$PASSING" | tail -1 | grep -oE '^[0-9]+')
if [[ "$COUNT" == "0" ]]; then
  echo "⚠️  No gappers qualify today. Writing empty analysis."
  cat > "$OUTPUT_FILE" << EOJSON
{
  "updated_at": "$NOW",
  "gappers": []
}
EOJSON
else
  echo "🔬 Researching $COUNT gappers..."
  echo ""

  # ── Progress filter: parse stream-json and show live status ──
  progress_filter() {
    python3 -c "
import sys, json
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        msg = json.loads(line)
    except:
        continue
    mtype = msg.get('type', '')
    if mtype == 'assistant' and msg.get('message', {}).get('content'):
        for block in msg['message']['content']:
            if block.get('type') == 'tool_use':
                name = block.get('name', '')
                inp = block.get('input', {})
                if name == 'WebSearch':
                    print(f'  🔍 Searching: {inp.get(\"query\", \"\")[:80]}', flush=True)
                elif name == 'WebFetch':
                    url = inp.get('url', '')
                    print(f'  🌐 Fetching: {url[:80]}', flush=True)
                elif name == 'Read':
                    print(f'  📖 Reading: {inp.get(\"file_path\", \"\").split(\"/\")[-1]}', flush=True)
                elif name == 'Write':
                    print(f'  ✏️  Writing: {inp.get(\"file_path\", \"\").split(\"/\")[-1]}', flush=True)
            elif block.get('type') == 'text':
                text = block.get('text', '').strip()
                if text and len(text) < 200:
                    print(f'  💬 {text[:120]}', flush=True)
    elif mtype == 'result':
        cost = msg.get('cost_usd', 0)
        duration = msg.get('duration_ms', 0)
        mins = duration / 60000
        print(f'  ✅ Done — {mins:.1f}m, \${cost:.2f}', flush=True)
"
  }

  cd "$REPO_DIR"
  cat "$PROMPT_FILE" | claude --print \
    --output-format stream-json --verbose \
    --allowedTools "Read,Write,Bash,WebSearch,WebFetch,Glob,Grep" \
    | progress_filter

  echo ""
fi

# ── Validate output ──
if [[ ! -f "$OUTPUT_FILE" ]]; then
  echo "❌ Output file not written. Claude may have failed."
  exit 1
fi

python3 -c "
import json
with open('$OUTPUT_FILE') as f:
    d = json.load(f)
gappers = d.get('gappers', [])
cats = {}
for g in gappers:
    c = g.get('category', 'Unknown')
    cats[c] = cats.get(c, 0) + 1
print(f'✅ Valid JSON: {len(gappers)} gappers')
for g in gappers:
    sections = len(g.get('analysis_sections', []))
    print(f'  {g[\"ticker\"]:6s} {g.get(\"category\",\"?\"):30s} {sections} sections')
if cats:
    print(f'  Categories: {cats}')
" || { echo "❌ Invalid JSON output"; exit 1; }

# ── Git commit + push ──
if [[ "$DRY_RUN" == true ]]; then
  echo ""
  echo "🧪 Dry run complete. JSON written to $OUTPUT_FILE"
else
  echo ""
  echo "📤 Committing and pushing..."
  cd "$REPO_DIR"
  git add public/data/gapper_analysis.json
  git commit -m "Gapper analysis update $(date +%Y-%m-%d_%H%M)" || true
  git push && echo "✅ Pushed to Vercel — deploy in ~30s" || echo "⚠️  Push failed. Run 'git push' manually."
fi

echo ""
echo "🏁 Done."
