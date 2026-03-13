#!/usr/bin/env bash
# cascade-daily.sh — Daily automated cascade refinement
# Cron: 0 9 * * * /Users/octiv/Octiv_MVP/scripts/cascade-daily.sh >> /tmp/cascade-daily.log 2>&1

set -e

SKILL_DIR="$HOME/.claude/skills/notebooklm"
PROJECT_ROOT="/Users/octiv/Octiv_MVP"
LOG_FILE="/tmp/cascade-daily.log"
PYTHON="$SKILL_DIR/.venv/bin/python"

echo "[$(date '+%Y-%m-%d %H:%M')] cascade-daily start"

# Verify venv exists
if [ ! -f "$PYTHON" ]; then
  echo "[ERROR] venv not found at $PYTHON — run setup_environment.py first"
  exit 1
fi

# Rotate log if > 500KB
if [ -f "$LOG_FILE" ] && [ "$(stat -f%z "$LOG_FILE" 2>/dev/null || stat -c%s "$LOG_FILE")" -gt 512000 ]; then
  mv "$LOG_FILE" "${LOG_FILE}.bak"
fi

# Question rotates by day-of-week
DOW=$(date '+%u')  # 1=Mon ... 7=Sun
case $DOW in
  1) Q="What are the most important architectural patterns and decisions this week?" ;;
  2) Q="What agent behaviors and skills showed the most improvement recently?" ;;
  3) Q="What infrastructure changes (Redis, Docker, PaperMC) need attention?" ;;
  4) Q="What are the key lessons learned from recent test failures and fixes?" ;;
  5) Q="What is the current project status and what are the next priorities?" ;;
  6) Q="Summarize the Minecraft agent team's survival and resource capabilities." ;;
  7) Q="What knowledge gaps exist between the strategic roadmap and current implementation?" ;;
  *) Q="Summarize current project state and next steps." ;;
esac

echo "[$(date '+%Y-%m-%d %H:%M')] question: $Q"

cd "$SKILL_DIR"
"$PYTHON" scripts/cascade_query.py \
  --question "$Q" \
  --save-to-vault \
  --project-root "$PROJECT_ROOT" \
  2>&1

echo "[$(date '+%Y-%m-%d %H:%M')] cascade-daily done"
