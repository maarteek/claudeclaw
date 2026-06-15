#!/usr/bin/env bash
# tunnel-watchdog.sh - relay-aware health watchdog for the mak-node VS Code tunnel.
#
# Owned by the ClaudeClaw "ops" agent (@MartyOpsBot). Alerts go through OpsBot.
#
# WHY THIS EXISTS (incident 2026-06-15):
#   `systemctl --user is-active code-tunnel.service` reported "active (running)"
#   while the tunnel was completely unreachable over WAN. The long-lived process
#   had silently lost its outbound connection to the Microsoft relay and never
#   re-established it; because the process did not exit, systemd's Restart=always
#   never fired. A second, deeper failure mode: the relay-side tunnel resource
#   EXPIRES after prolonged inactivity, after which the CLI 404s on every start
#   ("Cannot get tunnel, tunnel is expired") and a plain restart loops forever.
#
#   So health MUST be measured by the presence of a live ESTABLISHED TCP socket
#   from code-tunnel to the cluster relay on :443 -- never by service state alone.
#
# MODES:
#   (no arg)   check + auto-recover + alert via OpsBot on any state change
#   status     read-only health report to stdout (exit 0 healthy, 1 unhealthy) -- for OpsBot
#   test-alert send a test message through OpsBot and exit
#
set -uo pipefail

SERVICE="code-tunnel.service"
CLI="$HOME/bin/code-tunnel"
CFG="$HOME/.vscode/cli/code_tunnel.json"
TUNNEL_NAME="mak-node"
ENV_FILE="$HOME/claudeclaw/.env"
STATE_FILE="$HOME/.cache/tunnel-watchdog.state"
LOG_TAG="tunnel-watchdog"

mkdir -p "$(dirname "$STATE_FILE")"

log() { echo "[$LOG_TAG] $(date '+%Y-%m-%d %H:%M:%S') $*"; }

# ---- OpsBot alerting -------------------------------------------------------
load_creds() {
    # Source only the two keys we need, without leaking the whole .env.
    OPS_BOT_TOKEN=$(grep -E '^OPS_BOT_TOKEN=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-)
    CHAT_ID=$(grep -E '^ALLOWED_CHAT_ID=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-)
}

alert() {
    local msg="$1"
    load_creds
    if [[ -z "${OPS_BOT_TOKEN:-}" || -z "${CHAT_ID:-}" ]]; then
        log "ALERT (no OpsBot creds, stderr only): $msg"; return
    fi
    curl -s --max-time 15 -X POST \
        "https://api.telegram.org/bot${OPS_BOT_TOKEN}/sendMessage" \
        -d chat_id="${CHAT_ID}" \
        --data-urlencode text="🛰️ mak-node tunnel watchdog
${msg}" >/dev/null 2>&1 || log "alert send failed"
}

# ---- health probes ---------------------------------------------------------
relay_ip() {
    # Resolve the relay IP for this tunnel's cluster (default uks1).
    local cluster
    cluster=$(grep -oE '"cluster":"[^"]+"' "$CFG" 2>/dev/null | cut -d'"' -f4)
    [[ -z "$cluster" ]] && cluster="uks1"
    getent hosts "${cluster}.rel.tunnels.api.visualstudio.com" 2>/dev/null | awk '{print $1}' | head -1
}

has_relay_connection() {
    # TRUE iff code-tunnel holds an ESTABLISHED :443 socket to the relay IP.
    local rip; rip=$(relay_ip)
    [[ -z "$rip" ]] && return 1
    ss -tnp 2>/dev/null | grep -q "ESTAB.*${rip}:443.*code-tunnel"
}

service_active() {
    [[ "$(systemctl --user show "$SERVICE" --property=ActiveState --value 2>/dev/null)" == "active" ]]
}

tunnel_expired() {
    # TRUE if recent journal shows the relay rejecting the tunnel as expired/404.
    journalctl --user -u "$SERVICE" --since "5 min ago" --no-pager 2>/dev/null \
        | grep -qiE "tunnel is expired|Tunnel Expiration|status 404 Not Found"
}

logged_in() {
    "$CLI" tunnel user show 2>/dev/null | grep -qi "logged in"
}

# ---- recovery --------------------------------------------------------------
recover_restart() {
    log "recovery: simple restart"
    systemctl --user restart "$SERVICE"
    sleep 12
}

recover_reclaim() {
    # Expired-tunnel recovery (proven 2026-06-15): the relay-side tunnel resource
    # is gone but still owns the name. unregister no-ops on an expired tunnel, so
    # we create a FRESH tunnel under a throwaway name (new resource id), then
    # rename it to reclaim "mak-node", then hand back to systemd.
    log "recovery: expired-tunnel reclaim sequence"
    systemctl --user stop "$SERVICE"
    "$CLI" tunnel unregister >/dev/null 2>&1
    local probe="maknode-reclaim-$(date +%s)"
    log "  creating fresh tunnel via throwaway name: $probe"
    timeout 30 "$CLI" tunnel --accept-server-license-terms --name "$probe" >/tmp/tunnel-reclaim.log 2>&1
    if ! grep -q '"id"' "$CFG" 2>/dev/null; then
        log "  reclaim FAILED: no fresh tunnel registered"; return 1
    fi
    log "  renaming fresh tunnel -> $TUNNEL_NAME"
    "$CLI" tunnel rename "$TUNNEL_NAME" >/dev/null 2>&1
    systemctl --user start "$SERVICE"
    sleep 12
}

# ---- state (de-dupe alerts) ------------------------------------------------
read_state()  { cat "$STATE_FILE" 2>/dev/null || echo "unknown"; }
write_state() { echo "$1" > "$STATE_FILE"; }

# ---- status mode (read-only, for OpsBot) -----------------------------------
if [[ "${1:-}" == "status" ]]; then
    rip=$(relay_ip)
    if has_relay_connection; then
        echo "HEALTHY: code-tunnel has live relay connection to ${rip}:443 (https://vscode.dev/tunnel/${TUNNEL_NAME})"
        exit 0
    fi
    if service_active; then
        echo "UNHEALTHY: service active but NO relay connection (silent zombie). relay=${rip:-unresolved}"
    elif tunnel_expired; then
        echo "UNHEALTHY: tunnel EXPIRED server-side; restart loop. Needs reclaim."
    else
        echo "UNHEALTHY: service not active. $(systemctl --user show "$SERVICE" --property=ActiveState --value 2>/dev/null)"
    fi
    exit 1
fi

if [[ "${1:-}" == "test-alert" ]]; then
    alert "test-alert OK"
    echo "sent"; exit 0
fi

# ---- main check + auto-recover ---------------------------------------------
prev=$(read_state)

if has_relay_connection; then
    write_state "healthy"
    [[ "$prev" != "healthy" && "$prev" != "unknown" ]] && \
        alert "✅ RECOVERED — relay connection re-established. https://vscode.dev/tunnel/${TUNNEL_NAME}"
    log "healthy (relay connection present)"
    exit 0
fi

# Not healthy. Don't auto-fix if GitHub auth is gone — that needs interactive reauth.
if ! logged_in; then
    write_state "needs-reauth"
    [[ "$prev" != "needs-reauth" ]] && alert "❌ tunnel DOWN and GitHub auth is gone. Manual reauth needed: \`$CLI tunnel user login\` in an interactive SSH session. See memory mak-node-vscode-tunnel."
    log "down + not logged in -> alert, no auto-recover"
    exit 1
fi

log "unhealthy: no relay connection — attempting recovery"

if tunnel_expired; then
    recover_reclaim
else
    recover_restart
    # If a plain restart trips the expired-tunnel error, escalate to reclaim.
    if ! has_relay_connection && tunnel_expired; then
        recover_reclaim
    fi
fi

# Verify outcome.
if has_relay_connection; then
    write_state "healthy"
    alert "✅ RECOVERED — tunnel was down, watchdog restored it. relay link live. https://vscode.dev/tunnel/${TUNNEL_NAME}"
    log "recovery succeeded"
    exit 0
else
    write_state "failed"
    [[ "$prev" != "failed" ]] && alert "🚨 tunnel DOWN — automatic recovery FAILED. Needs hands-on. \`journalctl --user -u ${SERVICE} -n 40\`"
    log "recovery FAILED"
    exit 1
fi
