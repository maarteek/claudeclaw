# Circuit Breaker for Repeated Tool Failures (PARKED)

Status: **Parked.** No code change planned at this time. This document
exists so a future session can pick the work up cold and implement it
without rebuilding context.

Date documented: 2026-04-28
Related work: `docs/superpowers/specs/2026-04-28-claudeclaw-control-improvements-design.md` (covers fixes #1 and #2; this doc covers #3)
Anchor incident: 2026-04-27 to 2026-04-28 TorrentLeech grab failures (see kickoff at `~/.claude/plans/claudeclaw-control-improvements-kickoff.md`)

## Problem statement

When an MCP tool returns an error, the LLM generates a fresh diagnostic
theory. When that theory's recommendation fails too, another fresh theory.
There is no "I have been wrong N times on the same surface, I should stop
generating theories" check.

The result is a theory cascade. Each new theory has the same priors as the
previous one and is no more likely to be right. In the anchor incident
this cascade ran across three sessions over 24 hours, ending with a
proposed destructive action (rotate qBit password) that marty had to
explicitly reject.

## Why this is parked

Fixes #1 (corrections → memory) and #2 (recommendation gate) are being
shipped now. With both in place:

- Wrong theories that produce destructive recommendations are caught by
  the recommendation gate before reaching marty.
- When marty corrects a theory, the correction becomes a pinned memory
  that surfaces in future sessions — preventing the same wrong theory
  from regenerating cleanly.

The residual harm of the theory cascade — the model wastes its own tokens
generating fresh wrong theories before each tool failure — is annoying
but not damaging. The breaker is the structurally hardest of the three
issues (it requires cross-turn persisted state) and the upside without
the destructive-action risk is small.

The CLAUDE.md "When tools fail repeatedly" rule is shipped as part of
the main work, providing a soft prompt-level nudge even without the
runtime enforcement described below.

## Design

### Surface keying

A "surface" is the unit on which streaks are counted. Three options
considered:

| Option | What it tracks | Verdict |
|---|---|---|
| Exact tool name | e.g. `mcp__mcp-torrent-search__add_torrent` | Too narrow — the anchor incident spanned multiple tools (`search_torrents`, `get_release_details`, `add_torrent`) under the same MCP server, all failing for the same root cause |
| **MCP server prefix** | e.g. `mcp-torrent-search` | **Adopted.** Treats the integration as the unit, which is what actually fails |
| Outer system | e.g. "torrent search" regardless of which server | Too broad — would conflate a future `mcp-torrent-search-2` outage with the current one |

Implementation: parse the `name` field from a `tool_use` block. If it
matches `mcp__<server>__<tool>`, the surface is `<server>`. For non-MCP
tools (Bash, Read, etc.), the surface is the tool name itself.

### State schema

New SQLite table:

```sql
CREATE TABLE tool_failure_streaks (
  agent_id TEXT NOT NULL,
  surface TEXT NOT NULL,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_failure_at INTEGER NOT NULL,        -- unix seconds
  last_error_preview TEXT,                  -- first ~500 chars of error content
  PRIMARY KEY (agent_id, surface)
);

CREATE INDEX idx_tool_failure_streaks_active
  ON tool_failure_streaks (agent_id, consecutive_failures);
```

Cross-session persistence is the whole point. The anchor incident spanned
three sessions over 24 hours — in-memory state would not have caught it.

### Streak counting

When a `tool_result` block is captured (extending the same hook used by
fix #2's recommendation gate), call `recordToolOutcome`:

```ts
function recordToolOutcome(
  agentId: string,
  surface: string,
  isError: boolean,
  errorPreview: string
): void {
  if (isError) {
    incrementStreak(agentId, surface, errorPreview);
  } else {
    resetStreak(agentId, surface);
  }
}
```

- `incrementStreak`: `INSERT ... ON CONFLICT (agent_id, surface) DO UPDATE
  SET consecutive_failures = consecutive_failures + 1, last_failure_at = ...,
  last_error_preview = ...`
- `resetStreak`: `UPDATE tool_failure_streaks SET consecutive_failures = 0
  WHERE agent_id = ? AND surface = ?` (don't delete the row; preserve
  history for diagnostics)

### Reset rules

Streaks reset on:

| Trigger | Mechanism |
|---|---|
| Any successful tool call from the same surface | `resetStreak` called from `recordToolOutcome` |
| `/newchat` command | Wipe all streaks for `(agent_id, *)` in the /newchat handler |
| Streak age > `STREAK_MAX_AGE_HOURS` (default 24) | Treated as zero in `getActiveStreaks` query (not deleted, just ignored) |

Deliberately NOT in scope:

- LLM-detected "user implicitly acknowledged the failure" reset (e.g.
  marty replies "ok I'll handle it"). Adds Gemini classifier complexity
  without clear benefit. Rely on explicit `/newchat` instead.
- Time-based decay (e.g. failure count halves every hour). Not enough
  upside vs. the simpler max-age cutoff.

### Trigger points — two, complementary

**Pre-turn injection.** Before `runAgent` runs, query
`getActiveStreaks(agentId, threshold=CIRCUIT_BREAKER_THRESHOLD)`. For each
streak above the threshold, prepend a system-style notice to the user
message:

```
[Circuit breaker] You have had {N} consecutive failures from `{surface}`.
Do NOT generate a new diagnostic theory. The last error was:

{last_error_preview}

Dump that raw error verbatim to marty, say what tools you have already tried,
and ask what's missing. Do not propose any state-change action until marty
has responded.

[End circuit breaker]
```

This catches the cross-session anchor case. A new session would receive
this notice before the model has a chance to formulate a fresh wrong
theory.

**Mid-turn abort.** When `recordToolOutcome` is called inside `runAgent`'s
event loop and the streak crosses the threshold *during* this turn, abort
the SDK query immediately via `abortController.abort()`. Return a synthetic
result whose text is the raw last error verbatim. Do not let the model see
the result and formulate a recovery — that is the cascade we are preventing.

This catches the intra-turn theory cascade (errors compounding within a
single agent run).

### Threshold and config knobs

| Env var | Default | Meaning |
|---|---|---|
| `CIRCUIT_BREAKER_ENABLED` | `true` | Master switch. When `false`, both triggers are disabled and `recordToolOutcome` is a no-op. |
| `CIRCUIT_BREAKER_THRESHOLD` | `2` | Number of consecutive failures before tripping. Two is enough — by the third the LLM is just guessing. |
| `STREAK_MAX_AGE_HOURS` | `24` | Streaks older than this are ignored in `getActiveStreaks` (but rows preserved for diagnostics). |

The kickoff suggested 2 or 3 for the threshold; 2 is correct for the
anchor incident class. See scenario walkthrough below.

## Scenario walkthrough — the anchor incident

Documents the exact 2026-04-27 to 2026-04-28 sequence and shows where
each trigger would have fired.

| Time | Event | Streak state | Trigger |
|---|---|---|---|
| 23:17 | First `mcp__mcp-torrent-search__*` failure | `mcp-torrent-search`: 1 | Below threshold, no trigger. Model generates first theory: "TL credentials need refreshing." |
| 23:32 | Second TL failure | `mcp-torrent-search`: 2 | **THRESHOLD HIT.** Mid-turn abort fires. Raw error dumped to marty. No "TL Prowlarr download endpoint is dead" theory generated. |
| 23:46 | (would not have been generated) | (frozen at 2) | Streak still at 2; pre-turn injection on next session would force raw-error dump. |
| 00:09 | (the destructive "Want me to set the qBit password to something new?" recommendation) | (would never have been generated) | Pre-turn injection forces raw-error dump on every subsequent turn until streak resets. |
| 00:39 | marty: "you've got it wrong" | (would have been a non-event) | The destructive recommendation never reached marty in the first place. |

The threshold of 2 (not 3) is what makes the difference. At threshold=3,
the 23:46 theory would have been generated and the 00:09 recommendation
would have followed.

## Implementation hook points

| Where | What | File |
|---|---|---|
| `recordToolOutcome` call site | Inside the `for await (const event of query(...))` loop in `runAgent`, when a `tool_result` block is captured (same hook as fix #2) | `src/agent.ts` |
| Mid-turn abort decision | Same hook; check streak after increment, abort if threshold hit | `src/agent.ts` |
| Pre-turn injection | Before `runAgent` is called, in `bot.ts` (Telegram handler) and `bot.ts` (dashboard handler) | `src/bot.ts` |
| `/newchat` reset | In the `/newchat` command handler | `src/bot.ts:830` |
| New module | Streak read/write functions | `src/circuit-breaker.ts` (new) |
| DB migration | `tool_failure_streaks` table | `migrations/NNNN-tool-failure-streaks.sql` (new) |

## Test plan when implemented

| Test | Mechanism |
|---|---|
| Streak increments on consecutive errors from same surface | Mock `recordToolOutcome` calls; assert DB state |
| Streak resets on success | Same |
| Streak resets on `/newchat` | Invoke command handler; assert all rows zeroed |
| Streak ignored after `STREAK_MAX_AGE_HOURS` | Insert old row; query `getActiveStreaks`; assert empty result |
| Pre-turn injection fires at threshold | Set streak=2 in test DB; call message handler; assert injected notice present in agent prompt |
| Mid-turn abort fires at threshold | Mock SDK event stream that emits 2 errors; assert `abortController.abort()` called |
| Cross-session persistence | Insert row, simulate process restart (new DB connection), query, assert intact |
| Per-agent isolation | Increment for `main`; assert `research` agent's threshold not affected |
| `CIRCUIT_BREAKER_ENABLED=false` | Both triggers no-op, `recordToolOutcome` no-op |

## Estimated implementation cost

| Item | Lines |
|---|---|
| `src/circuit-breaker.ts` (new) | ~150 |
| `src/agent.ts` extension (mid-turn abort, recordToolOutcome) | ~40 |
| `src/bot.ts` extension (pre-turn injection × 2 sites, /newchat reset) | ~40 |
| `src/db.ts` (streak read/write helpers) | ~30 |
| `migrations/NNNN-tool-failure-streaks.sql` | ~10 |
| `src/circuit-breaker.test.ts` (new) | ~150 |
| `src/agent.test.ts` extensions | ~30 |
| `src/bot.test.ts` extensions | ~20 |

**Total: ~250 lines code + ~200 lines tests + 1 SQLite migration.** About a
day of focused work. Add 30 minutes for end-to-end verification (manual
trip of the breaker via a deliberately broken MCP server in dev).

## Future refinements (not in scope when first implemented)

- Per-tool keying as an alternative to per-server (config knob to choose)
- Telegram notification when the breaker trips (so marty knows the bot
  has stopped trying rather than gone silent)
- Dashboard visibility: surface active streaks in the Mission Control UI
- Surface-specific thresholds (some integrations might warrant lower or
  higher than the global default)
