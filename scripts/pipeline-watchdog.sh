#!/bin/bash
# pipeline-watchdog.sh — replaces the LLM "read last_run.json and alert if stale"
# scheduled tasks with deterministic shell checks.
#
# Those tasks cost ~1.05B tokens in Aug 2026 (762 runs, 38% of ClaudeClaw's
# volume) to do what this file does for free. Same alert text, same channel,
# same silence-when-healthy behaviour.
#
# Usage:
#   pipeline-watchdog.sh              # check all, alert on failure, silent when healthy
#   pipeline-watchdog.sh --dry-run    # print verdicts, never send
#   pipeline-watchdog.sh --verbose    # print verdicts AND send real alerts
#
# Alerts are throttled by state transition, not sent every run. The checks run
# every 10 minutes; resending a persistent failure each time would produce 144
# messages/day. It alerts when the problem set CHANGES, reminds at most every
# PIPELINE_WATCHDOG_REMIND_SECS (default 6h) while it persists, and sends one
# all-clear on recovery. State: PIPELINE_WATCHDOG_STATE (default
# ~/.cache/pipeline-watchdog.state); delete it to force the next run to alert.
#
# Exit: 0 = all healthy (or alerts sent successfully), 1 = a check failed to run.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOTIFY="$SCRIPT_DIR/notify.sh"

DRY_RUN=0; VERBOSE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1; VERBOSE=1 ;;
    --verbose) VERBOSE=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# label | path | max_age_seconds
# max_age = the pipeline's real systemd cadence + grace. Derived from the actual
# OnCalendar values, NOT from the old LLM prompts: those used a 15-minute window
# that only worked because the check was scheduled 5 minutes behind the pipeline.
# That coupling meant a failure was caught only if it happened to fall in the
# sampled window. Decoupled thresholds let this run every few minutes instead.
#   sparsi-invoices   OnCalendar=*-*-* 0/2:30:00   (2h)    -> 2h30m
#   sparsi-prop-sync  OnCalendar=*-*-* 06:00:00    (daily) -> 26h
#   notebooklm-index  OnCalendar=*-*-* 06:00:00    (daily) -> 26h
#   gsc-weekly-report OnCalendar=Mon *-*-* 07:17   (weekly)-> 7d12h
WATCHES=(
  "Sparsi invoices|/home/marty/data/sparsi-invoices/last_run.json|9000"
  "Sparsi prop sync|/home/marty/data/sparsi-prop-sync/last_run.json|93600"
  "NotebookLM index|/home/marty/data/notebooklm-index/last_run.json|93600"
  "GSC weekly report|/home/marty/data/gsc-weekly-report/last_run.json|648000"
)

now=$(date +%s)
alerts=()

for w in "${WATCHES[@]}"; do
  IFS='|' read -r label path max_age <<< "$w"

  if [ ! -f "$path" ]; then
    alerts+=("$label: last_run.json MISSING at $path")
    [ "$VERBOSE" = 1 ] && echo "FAIL  $label — missing"
    continue
  fi

  ran_at=$(jq -r '.ran_at // empty' "$path" 2>/dev/null)
  exit_code=$(jq -r '.exit_code // empty' "$path" 2>/dev/null)

  if [ -z "$ran_at" ]; then
    alerts+=("$label: last_run.json unreadable or missing ran_at ($path)")
    [ "$VERBOSE" = 1 ] && echo "FAIL  $label — unparseable"
    continue
  fi

  ran_epoch=$(date -d "$ran_at" +%s 2>/dev/null)
  if [ -z "$ran_epoch" ]; then
    alerts+=("$label: ran_at not a parseable timestamp ($ran_at)")
    [ "$VERBOSE" = 1 ] && echo "FAIL  $label — bad timestamp"
    continue
  fi

  age=$(( now - ran_epoch ))
  problems=()
  [ "$age" -gt "$max_age" ] && problems+=("stale — last ran $ran_at, $((age/60))m ago, limit $((max_age/60))m")
  [ "${exit_code:-0}" != "0" ] && problems+=("exit_code=$exit_code")

  if [ ${#problems[@]} -gt 0 ]; then
    alerts+=("$label: $(IFS='; '; echo "${problems[*]}")")
    [ "$VERBOSE" = 1 ] && echo "FAIL  $label — ${problems[*]}"
  else
    [ "$VERBOSE" = 1 ] && echo "ok    $label — ran ${age}s ago, exit 0"
  fi
done

# --- alert throttling -------------------------------------------------------
# These checks run every 10 minutes, so a persistent failure must not resend on
# every run. Without this, two long-broken pipelines produce 144 alerts/day.
# Policy: alert when the set of problems CHANGES, remind at most every
# REMIND_SECS while the same set persists, and send one all-clear on recovery.
STATE_FILE="${PIPELINE_WATCHDOG_STATE:-$HOME/.cache/pipeline-watchdog.state}"
REMIND_SECS="${PIPELINE_WATCHDOG_REMIND_SECS:-21600}"   # 6h

fingerprint=""
if [ ${#alerts[@]} -gt 0 ]; then
  fingerprint=$(printf '%s\n' "${alerts[@]}" | sort | sha256sum | cut -d' ' -f1)
fi

prev_fingerprint=""; prev_sent=0
if [ -f "$STATE_FILE" ]; then
  IFS='|' read -r prev_fingerprint prev_sent < "$STATE_FILE" || true
fi
case "${prev_sent:-}" in ''|*[!0-9]*) prev_sent=0 ;; esac

send=0; msg=""
if [ -z "$fingerprint" ]; then
  if [ -n "$prev_fingerprint" ]; then
    send=1
    msg="Pipeline watchdog: all clear. Previously reported issues have cleared."
    [ "$VERBOSE" = 1 ] && echo "-> recovery (was failing, now healthy)"
  else
    [ "$VERBOSE" = 1 ] && echo "-> silent (healthy, unchanged)"
  fi
else
  msg="Pipeline watchdog: ${#alerts[@]} issue(s)"$'\n'"$(printf '  • %s\n' "${alerts[@]}")"
  if [ "$fingerprint" != "$prev_fingerprint" ]; then
    send=1
    [ "$VERBOSE" = 1 ] && echo "-> sending (problem set changed)"
  elif [ $(( now - prev_sent )) -ge "$REMIND_SECS" ]; then
    send=1
    msg="$msg"$'\n'"(unchanged since last alert; reminder every $((REMIND_SECS/3600))h)"
    [ "$VERBOSE" = 1 ] && echo "-> sending (reminder interval elapsed)"
  else
    [ "$VERBOSE" = 1 ] && echo "-> suppressed (unchanged; next reminder in $(( (REMIND_SECS - (now - prev_sent)) / 60 ))m)"
  fi
fi

# Dry run never sends and never mutates state.
if [ "$DRY_RUN" = 1 ]; then
  if [ "$send" = 1 ]; then echo; echo "WOULD SEND:"; echo "$msg"; fi
  exit 0
fi

if [ "$send" = 1 ]; then
  "$NOTIFY" "$msg" || { echo "watchdog: notify failed" >&2; exit 1; }
fi

mkdir -p "$(dirname "$STATE_FILE")"
if [ -z "$fingerprint" ]; then
  rm -f "$STATE_FILE"
elif [ "$send" = 1 ]; then
  printf '%s|%s\n' "$fingerprint" "$now" > "$STATE_FILE"
else
  printf '%s|%s\n' "$fingerprint" "$prev_sent" > "$STATE_FILE"
fi
exit 0
