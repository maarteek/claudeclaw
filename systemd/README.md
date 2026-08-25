# systemd user units (Linux)

The `launchd/` directory holds the macOS equivalents. These are the Linux user
units, installed to `~/.config/systemd/user/`.

## pipeline-watchdog

Replaces the scheduled `scheduled_tasks` rows that asked an agent to read a
pipeline's `last_run.json` and alert if it was stale or exited non-zero. That
class cost 1.05B tokens across 762 runs in August 2026 — 38% of ClaudeClaw's
volume — to do a file test and a timestamp comparison.

It is also more correct than what it replaced. The old checks fired every two
hours against a fifteen-minute freshness window, so a failure was only caught if
it fell inside the sampled window; they passed at all because each was scheduled
five minutes behind its pipeline. `pipeline-watchdog.sh` takes its thresholds
from each pipeline's real `OnCalendar` cadence instead, which decouples it from
that schedule and lets it run every ten minutes.

Install:

    cp systemd/pipeline-watchdog.* ~/.config/systemd/user/
    systemctl --user daemon-reload
    systemctl --user enable --now pipeline-watchdog.timer

The four replaced tasks are `paused`, not deleted. To restore them:

    sqlite3 ~/claudeclaw/store/claudeclaw.db \
      "UPDATE scheduled_tasks SET status='active' \
       WHERE id IN ('fe7c631c','4aa81724','79deed62','8bbf4a3a');"

Add a new watch by appending to the `WATCHES` array in
`scripts/pipeline-watchdog.sh`; set `max_age` from the pipeline's own
`OnCalendar` cadence plus grace, not from how often the watchdog runs.
