#!/bin/bash
# ─────────────────────────────────────────────────────────
# ThemePulse Short Scan Analysis — Claude Code runner
# O'Neil methodology short candidate identification
#
# Usage:
#   ./scripts/run-short-scan.sh          # full run (research + write + push)
#   ./scripts/run-short-scan.sh --dry    # generate JSON but skip git push
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
  echo "📅 Weekend (day $DOW) — skipping short scan analysis."
  exit 0
fi

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROMPT_FILE="$REPO_DIR/scripts/short-scan-prompt.md"
UPDATE_PROMPT_FILE="$REPO_DIR/scripts/short-scan-update-prompt.md"
OUTPUT_FILE="$REPO_DIR/public/data/short_scan_analysis.json"
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
echo "🕐 Starting short scan analysis at $NOW"
echo ""

# ── Preview: count stocks that pass base filters and show top short candidates ──
PREVIEW=$(python3 -c "
import json

with open('$REPO_DIR/public/dashboard_data.json') as f:
    d = json.load(f)

# Build failed EP lookup
failed_eps = set()
for ep in d.get('ep_signals', []):
    if ep.get('consol', {}).get('status') == 'failed':
        failed_eps.add(ep['ticker'])

stocks = [s for s in d.get('stocks', [])
    if (s.get('market_cap_raw') or 0) >= 1_000_000_000
    and (s.get('avg_dollar_vol_raw') or 0) >= 20_000_000
    and (s.get('avg_volume_raw') or 0) >= 500_000
    and (s.get('price') or 0) > 5]

# Compute tags
candidates = []
for s in stocks:
    tags = []
    sma50 = s.get('sma50_pct')
    sma200 = s.get('sma200_pct')
    sma20 = s.get('sma20_pct')
    pfh = s.get('pct_from_high', 0) or 0
    chg = s.get('change_pct', 0) or 0
    rv = s.get('rel_volume', 0) or 0
    rs = s.get('rs_rank', 50) or 50
    ts = s.get('ts_rank', 50) or 50
    rts = s.get('rts_score', 50) or 50
    eps_y = s.get('eps_yoy')
    eps_yp = s.get('eps_yoy_prev')
    sal_y = s.get('sales_yoy')
    r1y = s.get('return_1y', 0) or 0
    r6m = s.get('return_6m', 0) or 0

    if sma50 is not None and sma50 < -2 and pfh < -15:
        tags.append('BD')
    if chg < -2 and rv >= 2.0:
        tags.append('DT')
    if eps_y is not None and eps_y < 0 and sal_y is not None and sal_y < 0:
        tags.append('WK')
    if eps_y is not None and eps_yp is not None and eps_y < eps_yp - 10 and eps_yp > 10:
        tags.append('ED')
    if rs <= 20:
        tags.append('LG')
    if sma20 is not None and sma20 < 0 and sma50 is not None and sma50 < 0 and sma200 is not None and sma200 < 0:
        tags.append('MA')
    if pfh < -25 and (r1y > 50 or r6m > 30):
        tags.append('FL')
    elif rs <= 35 and r1y > 0:
        tags.append('FL')
    if sma50 is not None and sma200 is not None and sma50 < sma200 and sma200 < 0:
        tags.append('DC')
    if s.get('ticker', '') in failed_eps:
        tags.append('FEP')

    if len(tags) >= 2:
        score = (
            len(tags) * 15 +
            max(0, -pfh - 15) * 0.5 +
            max(0, -chg) * 2 +
            (100 - rs) * 0.3 +
            (100 - ts) * 0.2 +
            (100 - rts) * 0.1 +
            (20 if sma50 is not None and sma200 is not None and sma50 < sma200 else 0) +
            (15 if 'FL' in tags else 0) +
            (10 if 'FEP' in tags else 0)
        )
        candidates.append((s, tags, score))

candidates.sort(key=lambda x: -x[2])
top = candidates[:15]

for s, tags, score in top:
    tag_str = '+'.join(tags)
    print(f'  {s[\"ticker\"]:6s} tags={tag_str:24s} score={score:5.0f}  rs={s.get(\"rs_rank\",\"?\")}  ts={s.get(\"ts_rank\",\"?\")}  off_hi={s.get(\"pct_from_high\",0):+.0f}%  chg={s.get(\"change_pct\",0):+.1f}%  mc={s.get(\"market_cap\",\"?\")}')

print(f'---')
print(f'{len(candidates)} stocks have 2+ short tags (from {len(stocks)} passing base filters)')
" 2>/dev/null || echo "0 stocks have 2+ short tags")
echo "$PREVIEW"

COUNT=$(echo "$PREVIEW" | tail -1 | grep -oE '^[0-9]+')
if [[ "$COUNT" == "0" ]]; then
  echo "⚠️  No high-conviction short candidates today. Writing empty analysis."
  cat > "$OUTPUT_FILE" << EOJSON
{
  "content": "# Short Scan Analysis\n\nNo high-conviction short candidates on $TODAY.",
  "updated_at": "$NOW",
  "filters": "MCap≥\$1B + \$Vol≥\$20M + Vol≥500K + Price>\$5",
  "tickers": []
}
EOJSON
else
  # ── Detect full vs incremental mode ──
  RUN_MODE=$(python3 -c "
import json, sys, os
# Current top candidate tickers (top 10 by score)
with open('$REPO_DIR/public/dashboard_data.json') as f:
    d = json.load(f)

failed_eps = set()
for ep in d.get('ep_signals', []):
    if ep.get('consol', {}).get('status') == 'failed':
        failed_eps.add(ep['ticker'])

stocks = [s for s in d.get('stocks', [])
    if (s.get('market_cap_raw') or 0) >= 1_000_000_000
    and (s.get('avg_dollar_vol_raw') or 0) >= 20_000_000
    and (s.get('avg_volume_raw') or 0) >= 500_000
    and (s.get('price') or 0) > 5]

candidates = []
for s in stocks:
    tags = []
    sma50 = s.get('sma50_pct')
    sma200 = s.get('sma200_pct')
    sma20 = s.get('sma20_pct')
    pfh = s.get('pct_from_high', 0) or 0
    chg = s.get('change_pct', 0) or 0
    rv = s.get('rel_volume', 0) or 0
    rs = s.get('rs_rank', 50) or 50
    eps_y = s.get('eps_yoy')
    eps_yp = s.get('eps_yoy_prev')
    sal_y = s.get('sales_yoy')
    r1y = s.get('return_1y', 0) or 0
    r6m = s.get('return_6m', 0) or 0

    if sma50 is not None and sma50 < -2 and pfh < -15:
        tags.append('BD')
    if chg < -2 and rv >= 2.0:
        tags.append('DT')
    if eps_y is not None and eps_y < 0 and sal_y is not None and sal_y < 0:
        tags.append('WK')
    if eps_y is not None and eps_yp is not None and eps_y < eps_yp - 10 and eps_yp > 10:
        tags.append('ED')
    if rs <= 20:
        tags.append('LG')
    if sma20 is not None and sma20 < 0 and sma50 is not None and sma50 < 0 and sma200 is not None and sma200 < 0:
        tags.append('MA')
    if pfh < -25 and (r1y > 50 or r6m > 30):
        tags.append('FL')
    elif rs <= 35 and r1y > 0:
        tags.append('FL')
    if sma50 is not None and sma200 is not None and sma50 < sma200 and sma200 < 0:
        tags.append('DC')
    if s.get('ticker', '') in failed_eps:
        tags.append('FEP')

    if len(tags) >= 2:
        ts_val = s.get('ts_rank', 50) or 50
        rts_val = s.get('rts_score', 50) or 50
        score = (
            len(tags) * 15 +
            max(0, -pfh - 15) * 0.5 +
            max(0, -chg) * 2 +
            (100 - rs) * 0.3 +
            (100 - ts_val) * 0.2 +
            (100 - rts_val) * 0.1 +
            (20 if sma50 is not None and sma200 is not None and sma50 < sma200 else 0) +
            (15 if 'FL' in tags else 0) +
            (10 if 'FEP' in tags else 0)
        )
        candidates.append((s['ticker'], score))

candidates.sort(key=lambda x: -x[1])
current = sorted([t for t, _ in candidates[:10]])

# Existing analysis tickers
try:
    with open('$OUTPUT_FILE') as f:
        existing = json.load(f)
    prev = sorted(t['ticker'] for t in existing.get('tickers', []))
except:
    prev = []

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

  if [[ "$RUN_MODE" == "update" && -f "$UPDATE_PROMPT_FILE" ]]; then
    echo "♻️  Same tickers as last run — incremental price-action update only"
    echo ""
    cat "$UPDATE_PROMPT_FILE" | claude --print \
      --output-format stream-json --verbose \
      --allowedTools "Read,Write,Bash,WebSearch,WebFetch,Glob,Grep" \
      | progress_filter
  else
    echo "🔻 New candidates detected — full research for top short candidates..."
    echo ""
    cat "$PROMPT_FILE" | claude --print \
      --output-format stream-json --verbose \
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
shorts = sum(1 for t in tickers if t.get('verdict') == 'SHORT')
watch = sum(1 for t in tickers if t.get('verdict') == 'WATCH')
avoids = sum(1 for t in tickers if t.get('verdict') == 'AVOID')
size = len(json.dumps(d))
print(f'✅ Valid JSON: {len(tickers)} tickers ({shorts} SHORT, {watch} WATCH, {avoids} AVOID), {size:,} bytes')
for t in tickers:
    tabs = list(t.get('tabs', {}).keys())
    missing = [k for k in ['key_takeaways','fundamentals','chart_analysis','thesis','risks'] if k not in tabs]
    status = '✅' if not missing else f'⚠️  missing: {missing}'
    tag_str = '+'.join(t.get('tags', []))
    print(f'  {t[\"ticker\"]:6s} {t.get(\"verdict\",\"?\"):6s} tags={tag_str:24s} {status}')
" || { echo "❌ Invalid JSON output"; exit 1; }

# ── Git commit + push ──
if [[ "$DRY_RUN" == true ]]; then
  echo ""
  echo "🧪 Dry run complete. JSON written to $OUTPUT_FILE"
  echo "   To deploy: git add public/data/short_scan_analysis.json && git commit -m 'Short scan update' && git push"
else
  echo ""
  echo "📤 Committing and pushing..."
  cd "$REPO_DIR"
  git add public/data/short_scan_analysis.json
  git commit -m "Short scan analysis update $(date +%Y-%m-%d_%H%M)" || true
  git push && echo "✅ Pushed to Vercel — deploy in ~30s" || echo "⚠️  Push failed. Run 'git push' manually."
fi

echo ""
echo "🏁 Done."
