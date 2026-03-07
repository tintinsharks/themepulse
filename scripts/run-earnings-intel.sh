#!/bin/bash
# ─────────────────────────────────────────────────────────
# ThemePulse Earnings Intelligence — Claude Code runner
# Quarterly S&P 500 earnings analysis via AI research.
#
# Usage:
#   ./scripts/run-earnings-intel.sh          # full run (research + write + push)
#   ./scripts/run-earnings-intel.sh --dry    # generate JSON but skip git push
#
# Prerequisites:
#   - claude CLI installed and authenticated
#   - Run from the themepulse repo root (~/Claude Theme/themepulse)
# ─────────────────────────────────────────────────────────

set -euo pipefail

# ── Ensure nvm node/claude are on PATH (needed for launchd + non-interactive shells) ──
export PATH="$HOME/.nvm/versions/node/v20.20.0/bin:/opt/homebrew/bin:$PATH"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROMPT_FILE="$REPO_DIR/scripts/earnings-intel-prompt.md"
OUTPUT_FILE="$REPO_DIR/public/data/earnings_intel.json"
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

if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "❌ Prompt file not found at $PROMPT_FILE"
  exit 1
fi

# ── Auto-detect current earnings quarter ──
MONTH=$(date +%-m)
YEAR=$(date +%Y)
if [[ $MONTH -le 3 ]]; then
  QUARTER="Q4 $((YEAR - 1))"
elif [[ $MONTH -le 6 ]]; then
  QUARTER="Q1 $YEAR"
elif [[ $MONTH -le 9 ]]; then
  QUARTER="Q2 $YEAR"
else
  QUARTER="Q3 $YEAR"
fi
echo "📊 Earnings quarter: $QUARTER"

# ── Check staleness: skip if same quarter data exists and is <7 days old ──
if [[ -f "$OUTPUT_FILE" ]]; then
  EXISTING_QUARTER=$(python3 -c "
import json
with open('$OUTPUT_FILE') as f:
    d = json.load(f)
print(d.get('quarter', ''))
" 2>/dev/null || echo "")

  if [[ "$EXISTING_QUARTER" == "$QUARTER" ]]; then
    # Check file age
    if [[ "$(uname)" == "Darwin" ]]; then
      FILE_AGE_DAYS=$(( ($(date +%s) - $(stat -f %m "$OUTPUT_FILE")) / 86400 ))
    else
      FILE_AGE_DAYS=$(( ($(date +%s) - $(stat -c %Y "$OUTPUT_FILE")) / 86400 ))
    fi
    if [[ $FILE_AGE_DAYS -lt 7 ]]; then
      echo "⏭️  $QUARTER data exists and is ${FILE_AGE_DAYS}d old (< 7 days). Skipping."
      echo "   To force: rm $OUTPUT_FILE && $0"
      exit 0
    fi
    echo "♻️  $QUARTER data exists but is ${FILE_AGE_DAYS}d old. Refreshing..."
  else
    echo "🆕 New quarter detected (was: $EXISTING_QUARTER, now: $QUARTER). Running full analysis..."
  fi
fi

# ── Pull latest before running ──
cd "$REPO_DIR"
git stash --quiet 2>/dev/null
git pull --rebase origin main || echo "⚠️  git pull failed — continuing with local state"
git stash pop --quiet 2>/dev/null || true

# ── Timestamp ──
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "🕐 Starting earnings intelligence at $NOW"
echo "   This will take 15-30 minutes (researching all 11 GICS sectors)..."
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
                elif name == 'Bash':
                    cmd = inp.get('command', '')[:60]
                    print(f'  💻 Running: {cmd}', flush=True)
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

# ── Run Claude ──
cd "$REPO_DIR"
cat "$PROMPT_FILE" | claude --print \
  --output-format stream-json --verbose \
  --allowedTools "Read,Write,Bash,WebSearch,WebFetch,Glob,Grep" \
  | progress_filter

echo ""

# ── Validate output ──
if [[ ! -f "$OUTPUT_FILE" ]]; then
  echo "❌ Output file not written. Claude may have failed."
  exit 1
fi

# Quick JSON validation
python3 -c "
import json, sys
with open('$OUTPUT_FILE') as f:
    d = json.load(f)
quarter = d.get('quarter', '?')
themes = d.get('themes', [])
sectors = d.get('sectors', [])
signals = d.get('momentum_signals', [])
quotes = d.get('quotes', [])
companies = d.get('companies_analyzed', 0)
size = len(json.dumps(d))
print(f'✅ Valid JSON: {quarter}')
print(f'   {companies} companies, {len(themes)} themes, {len(sectors)} sectors, {len(signals)} signals, {len(quotes)} quotes')
print(f'   {size:,} bytes')
# Check all 11 sectors covered
sector_names = [s['name'] for s in sectors]
expected = ['Information Technology', 'Health Care', 'Financials', 'Consumer Discretionary',
            'Communication Services', 'Industrials', 'Consumer Staples', 'Energy',
            'Utilities', 'Real Estate', 'Materials']
missing = [s for s in expected if s not in sector_names]
if missing:
    print(f'⚠️  Missing sectors: {missing}')
else:
    print(f'   ✅ All 11 GICS sectors covered')
" || { echo "❌ Invalid JSON output"; exit 1; }

# ── Git commit + push ──
if [[ "$DRY_RUN" == true ]]; then
  echo ""
  echo "🧪 Dry run complete. JSON written to $OUTPUT_FILE"
  echo "   To deploy: git add public/data/earnings_intel.json && git commit -m 'Earnings intel update' && git push"
else
  echo ""
  echo "📤 Committing and pushing..."
  cd "$REPO_DIR"
  git add public/data/earnings_intel.json
  git commit -m "Earnings intel update $QUARTER $(date +%Y-%m-%d)" || true
  git push && echo "✅ Pushed to Vercel — deploy in ~30s" || echo "⚠️  Push failed. Run 'git push' manually."
fi

echo ""
echo "🏁 Done."
