#!/bin/bash
# ─────────────────────────────────────────────────────────
# ThemePulse AI Analysis — Claude Code runner
# No API key, no dependencies. Just claude CLI + this repo.
#
# Usage:
#   ./scripts/run-ai-analysis.sh          # full run (research + write + push)
#   ./scripts/run-ai-analysis.sh --dry    # generate JSON but skip git push
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
  echo "📅 Weekend (day $DOW) — skipping AI analysis."
  exit 0
fi

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROMPT_FILE="$REPO_DIR/scripts/ai-analysis-prompt.md"
OUTPUT_FILE="$REPO_DIR/public/data/ai_analysis.json"
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

# ── Timestamp ──
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TODAY=$(date +"%Y-%m-%d")
echo "🕐 Starting AI analysis at $NOW"

# ── Count stocks that pass filter (quick preview) ──
PASSING=$(python3 -c "
import json
with open('$REPO_DIR/public/dashboard_data.json') as f:
    d = json.load(f)
stocks = [s for s in d.get('stocks', [])
    if s.get('change_pct', 0) > 0
    and s.get('change_pct', 0) >= 4
    and s.get('rel_volume', 0) >= 1.5
    and s.get('market_cap_raw', 0) >= 300000000
    and s.get('avg_dollar_vol_raw', 0) >= 50000000]
for s in sorted(stocks, key=lambda x: -x.get('change_pct', 0)):
    print(f\"  {s['ticker']:6s} chg={s['change_pct']:+.1f}%  rv={s.get('rel_volume',0):.1f}x  rs={s.get('rs_rank','?')}  mc={s.get('market_cap','?')}\")
print(f'---')
print(f'{len(stocks)} stocks pass filters')
" 2>/dev/null || echo "0 stocks pass filters")
echo "$PASSING"

COUNT=$(echo "$PASSING" | tail -1 | grep -oE '^[0-9]+')
if [[ "$COUNT" == "0" ]]; then
  echo "⚠️  No stocks pass filters today. Writing empty analysis."
  cat > "$OUTPUT_FILE" << EOJSON
{
  "content": "# EP Catalyst Analysis\n\nNo stocks passed Scan Watch filters on $TODAY.",
  "updated_at": "$NOW",
  "filters": "Chg≥4% + Chg>0% + ZVR 1.5x+ + Small+ + \$Vol≥50M",
  "tickers": []
}
EOJSON
else
  # ── Detect full vs incremental mode ──
  # Compare current filtered tickers against existing ai_analysis.json
  UPDATE_PROMPT_FILE="$REPO_DIR/scripts/ai-analysis-update-prompt.md"
  RUN_MODE=$(python3 -c "
import json, sys
# Current filtered tickers
with open('$REPO_DIR/public/dashboard_data.json') as f:
    d = json.load(f)
current = sorted(s['ticker'] for s in d.get('stocks', [])
    if s.get('change_pct', 0) > 0
    and s.get('change_pct', 0) >= 4
    and s.get('rel_volume', 0) >= 1.5
    and s.get('market_cap_raw', 0) >= 300000000
    and s.get('avg_dollar_vol_raw', 0) >= 50000000)
# Existing analysis tickers
try:
    with open('$OUTPUT_FILE') as f:
        existing = json.load(f)
    prev = sorted(t['ticker'] for t in existing.get('tickers', []))
except:
    prev = []
# New tickers not in previous analysis
new_tickers = [t for t in current if t not in prev]
if prev and not new_tickers:
    print('update')
else:
    print('full')
" 2>/dev/null || echo "full")

  cd "$REPO_DIR"

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
                elif name == 'Grep':
                    print(f'  🔎 Grep: {inp.get(\"pattern\", \"\")[:60]}', flush=True)
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

  if [[ "$RUN_MODE" == "update" ]]; then
    echo "♻️  Same tickers as last run — incremental price-action update only"
    echo ""
    cat "$UPDATE_PROMPT_FILE" | claude --print \
      --output-format stream-json \
      --allowedTools "Read,Write,Bash,WebSearch,WebFetch,Glob,Grep" \
      | progress_filter
  else
    echo "🔬 New tickers detected — full research for $COUNT tickers..."
    echo ""
    cat "$PROMPT_FILE" | claude --print \
      --output-format stream-json \
      --allowedTools "Read,Write,Bash,WebSearch,WebFetch,Glob,Grep" \
      | progress_filter
  fi

  echo ""
fi

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
tickers = d.get('tickers', [])
buys = sum(1 for t in tickers if t.get('verdict') == 'BUY')
holds = sum(1 for t in tickers if t.get('verdict') == 'HOLD')
avoids = sum(1 for t in tickers if t.get('verdict') == 'AVOID')
size = len(json.dumps(d))
print(f'✅ Valid JSON: {len(tickers)} tickers ({buys} BUY, {holds} HOLD, {avoids} AVOID), {size:,} bytes')
for t in tickers:
    tabs = list(t.get('tabs', {}).keys())
    missing = [k for k in ['key_takeaways','revenue','margins','thesis','risks'] if k not in tabs]
    status = '✅' if not missing else f'⚠️  missing: {missing}'
    print(f'  {t[\"ticker\"]:6s} {t.get(\"verdict\",\"?\"):5s} {status}')
" || { echo "❌ Invalid JSON output"; exit 1; }

# ── Git commit + push ──
if [[ "$DRY_RUN" == true ]]; then
  echo ""
  echo "🧪 Dry run complete. JSON written to $OUTPUT_FILE"
  echo "   To deploy: git add public/data/ai_analysis.json && git commit -m 'AI update' && git push"
else
  echo ""
  echo "📤 Committing and pushing..."
  cd "$REPO_DIR"
  git add public/data/ai_analysis.json
  git commit -m "AI analysis update $(date +%Y-%m-%d_%H%M)" || true
  git push && echo "✅ Pushed to Vercel — deploy in ~30s" || echo "⚠️  Push failed. Run 'git push' manually."
fi

echo ""
echo "🏁 Done."
