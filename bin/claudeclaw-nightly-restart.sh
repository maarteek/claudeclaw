#!/usr/bin/env bash
# ClaudeClaw nightly restart - caps memory growth on the long-lived bot
# processes and starts every agent on a fresh session.
# The main bot peaked 3.0G/4.0G before a poll-thread death on 2026-06-27
# (2wk-2d uptime); a daily bounce keeps RSS low.
# Sessions: without a reset the main chat ran one session from late August
# to October through repeated compaction. All units are stopped first so no
# in-flight turn can write its session back after the reset.
# Starts are staggered a few seconds apart to avoid an API re-prime burst.
# Symlinked from ~/bin; registered in ~/bin/timer-watchdog.sh per the T7 rule.

set -uo pipefail

. "$HOME/.config/telegram/bot.env"   # provides TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
CHAT_ID="8004368107"
CLAW_DIR="$HOME/claudeclaw"
NODE="$HOME/.nvm/versions/node/v24.14.0/bin/node"   # same binary the units run

UNITS=(
    claudeclaw.service
    com.claudeclaw.agent-comms.service
    com.claudeclaw.agent-content.service
    com.claudeclaw.agent-ops.service
    com.claudeclaw.agent-research.service
    com.claudeclaw.agent-pricing.service
)

FAILED=()

echo "Nightly restart: stopping ${#UNITS[@]} units"
systemctl --user stop "${UNITS[@]}" || true

echo "Nightly restart: clearing sessions"
if ! (cd "$CLAW_DIR" && "$NODE" dist/session-reset-cli.js); then
    FAILED+=("session reset")
fi

for unit in "${UNITS[@]}"; do
    echo "Nightly restart: starting $unit"
    systemctl --user start "$unit" || true
    sleep 4
    state=$(systemctl --user show "$unit" --property=ActiveState --value 2>/dev/null || echo "unknown")
    if [[ "$state" != "active" ]]; then
        FAILED+=("$unit (state: $state)")
    fi
done

if (( ${#FAILED[@]} > 0 )); then
    msg="ClaudeClaw nightly restart ALERT on $(hostname) at $(date -u '+%H:%M UTC'): ${#FAILED[@]} problem(s): ${FAILED[*]}"
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
        -d "chat_id=${CHAT_ID}" -d "text=${msg}" > /dev/null 2>&1 || true
    echo "$msg" >&2
    exit 1
fi

echo "Nightly restart: sessions reset, all ${#UNITS[@]} units active."
exit 0
