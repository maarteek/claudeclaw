#!/bin/bash
# PreToolUse hook for Agent tool — sends Telegram notification immediately
# when Claude spawns a sub-agent. Receives JSON on stdin from Claude Code.
# Only fires when CLAUDECLAW_ACTIVE=1 (set by the bot's SDK env).

[ "$CLAUDECLAW_ACTIVE" != "1" ] && exit 0

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_name',''))" 2>/dev/null)
[ "$TOOL_NAME" != "Agent" ] && exit 0

DESC=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('description','Sub-agent spawned'))" 2>/dev/null)
[ -z "$DESC" ] && DESC="Sub-agent spawned"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$SCRIPT_DIR/notify.sh" "🔄 $DESC" &

exit 0
