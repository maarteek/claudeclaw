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

if [ ${#alerts[@]} -eq 0 ]; then
  exit 0   # healthy: stay completely silent, as the original task did
fi

msg="Pipeline watchdog: ${#alerts[@]} issue(s)"$'\n'"$(printf '  • %s\n' "${alerts[@]}")"
if [ "$DRY_RUN" = 1 ]; then
  echo; echo "WOULD SEND:"; echo "$msg"
else
  "$NOTIFY" "$msg" || { echo "watchdog: notify failed" >&2; exit 1; }
fi
