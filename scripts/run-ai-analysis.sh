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
# ── Allow running from within a Claude Code session (launchd or manual trigger) ──
unset CLAUDECODE 2>/dev/null || true

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
TRIGGER_MODE=false

if [[ "${1:-}" == "--dry" ]]; then
  DRY_RUN=true
  echo "🧪 Dry run — will generate JSON but skip git push"
elif [[ "${1:-}" == "--watch" ]]; then
  # Poll for dashboard trigger every 60s
  echo "👁  Watching for dashboard trigger..."
  while true; do
    TRIGGER=$(curl -sf "https://themepulse.vercel.app/api/trigger-analysis" 2>/dev/null || echo '{}')
    STATUS=$(echo "$TRIGGER" | python3 -c "import json,sys; d=json.load(sys.stdin); t=d.get('trigger'); print(t.get('status','') if t else '')" 2>/dev/null)
    if [[ "$STATUS" == "pending" ]]; then
      echo "🔔 Trigger detected! Starting analysis..."
      TRIGGER_MODE=true
      break
    fi
    sleep 60
  done
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

# ── Fetch AI queue from Vercel API ──
PASSING=$(python3 -c "
import json, urllib.request, sys
try:
    url = 'https://themepulse.vercel.app/api/ai-queue'
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
    queue = data.get('aiQueue', [])
    for t in queue:
        print(f'  {t}')
    print(f'---')
    print(f'{len(queue)} tickers in AI queue')
except Exception as e:
    print(f'⚠️  Failed to fetch queue: {e}', file=sys.stderr)
    print('0 tickers in AI queue')
" 2>/dev/null || echo "0 tickers in AI queue")
echo "$PASSING"

COUNT=$(echo "$PASSING" | tail -1 | grep -oE '^[0-9]+')
if [[ "$COUNT" == "0" ]]; then
  echo "⚠️  No tickers in AI queue. Writing empty analysis."
  cat > "$OUTPUT_FILE" << EOJSON
{
  "content": "# AI Analysis\n\nNo tickers in the AI analysis queue on $TODAY.",
  "updated_at": "$NOW",
  "filters": "AI Queue (Manual)",
  "tickers": []
}
EOJSON
else
  # ── Detect full vs incremental mode ──
  # Compare queued tickers against existing ai_analysis.json
  UPDATE_PROMPT_FILE="$REPO_DIR/scripts/ai-analysis-update-prompt.md"
  RUN_MODE=$(python3 -c "
import json, urllib.request, sys
# Current queued tickers
try:
    url = 'https://themepulse.vercel.app/api/ai-queue'
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
    current = sorted(data.get('aiQueue', []))
except:
    current = []
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

  # Timeout: 15 min for updates, 30 min for full research. Retry once on failure.
  MAX_ATTEMPTS=2
  if [[ "$RUN_MODE" == "update" ]]; then
    TIMEOUT_SECS=600
    echo "♻️  Same burst tickers as last run — incremental price-action update only"
  else
    TIMEOUT_SECS=1500
    echo "🔬 Momentum burst — full research (max 8 tickers, 25m timeout)..."
  fi

  # run_with_timeout <seconds> <prompt_file>
  run_with_timeout() {
    local secs=$1 prompt=$2
    cat "$prompt" | claude --print \
      --output-format stream-json --verbose \
      --max-turns 80 \
      --allowedTools "Read,Write,Bash,WebSearch,WebFetch,Glob,Grep" \
      | progress_filter &
    local pid=$!
    # Watchdog: kill after timeout
    ( sleep "$secs" && kill $pid 2>/dev/null && echo "  ⏰ Timed out after $((secs / 60)) minutes" ) &
    local wdog=$!
    wait $pid 2>/dev/null
    local exit_code=$?
    kill $wdog 2>/dev/null 2>&1; wait $wdog 2>/dev/null
    return $exit_code
  }

  ATTEMPT=0
  while [[ $ATTEMPT -lt $MAX_ATTEMPTS ]]; do
    ATTEMPT=$((ATTEMPT + 1))
    echo ""
    echo "⏱️  Attempt $ATTEMPT/$MAX_ATTEMPTS (timeout: $((TIMEOUT_SECS / 60))m)"

    if [[ "$RUN_MODE" == "update" ]]; then
      PROMPT_TO_USE="$UPDATE_PROMPT_FILE"
    else
      PROMPT_TO_USE="$PROMPT_FILE"
    fi

    if run_with_timeout "$TIMEOUT_SECS" "$PROMPT_TO_USE"; then
      echo "  ✅ Claude finished successfully"
      break
    else
      EXIT_CODE=$?
      echo "  ❌ Claude exited with code $EXIT_CODE"
      if [[ $ATTEMPT -lt $MAX_ATTEMPTS ]]; then
        echo "  🔄 Retrying..."
        pkill -f "claude.*--print.*stream-json" 2>/dev/null || true
        sleep 5
      else
        echo "  ❌ All $MAX_ATTEMPTS attempts failed"
      fi
    fi
  done

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
    missing = [k for k in ['key_takeaways','signals','revenue','margins','thesis','risks'] if k not in tabs]
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

# ── Clear trigger if we were triggered from dashboard ──
if [[ "$TRIGGER_MODE" == true ]]; then
  echo "🧹 Clearing dashboard trigger..."
  curl -sf -X POST "https://themepulse.vercel.app/api/trigger-analysis" \
    -H "Authorization: Bearer $TP_AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"action":"clear"}' >/dev/null 2>&1 || echo "⚠️  Failed to clear trigger"
fi

echo ""
echo "🏁 Done."
