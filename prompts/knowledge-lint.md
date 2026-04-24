# Knowledge Base Lint Sweep

Run a health check across the persistent memory system. Output a lint report to the Obsidian vault.

## Scope

Scan these locations:
1. `~/.claude/projects/-home-marty-projects/memory/MEMORY.md` (master index)
2. `~/.claude/projects/-home-marty-projects/memory/*.md` (all topic files, excluding daily-log-* and snapshots/)
3. `/home/marty/obsidian-vault/**/*.md` (Obsidian vault files)

## Checks

### Contradictions (severity: high)
- Compare claims across topic files. Flag where two files state conflicting facts about the same entity, date, amount, or status.
- Pay special attention to: pricing figures, API configurations, account statuses, project statuses (ACTIVE vs PARKED vs KILLED).
- Example: one file says "Airbnb multiplier is 18%" and another says "multiplier set to 0".

### Stale entries (severity: medium)
- Flag any topic file with "Updated" date older than 60 days that references an "active" matter, sprint, or pending action.
- Flag MEMORY.md index entries pointing to files that no longer exist.
- Flag daily logs older than 90 days (these should have been consolidated or can be archived).

### Orphaned files (severity: low)
- Topic files in the memory directory that are NOT referenced from MEMORY.md index.
- Obsidian vault files with no backlinks (check for `[[filename]]` references).

### Missing attribution (severity: info)
- Topic files that make factual claims (prices, dates, account numbers) without stating the source or date the information was verified.

### Duplicate content (severity: medium)
- Two or more files covering the same topic with overlapping content that should be consolidated.

## Output

Write the report to: `/home/marty/obsidian-vault/analysis/lint-report-YYYY-MM-DD.md`

Format:
```markdown
# Knowledge Base Lint Report - YYYY-MM-DD

## Summary
- X high severity issues
- X medium severity issues
- X low severity issues
- X info items
- Total files scanned: X

## High Severity
### [issue title]
- **Files**: [file1], [file2]
- **Issue**: [description of contradiction or problem]
- **Suggested fix**: [what to do]

## Medium Severity
...

## Low Severity
...

## Info
...

## Recommended Actions
1. [Top 3 actions to take, in priority order]
```

## Rules
- Read every file. Do not skip files or sample.
- Be specific. Quote the contradicting text from each file.
- Do not modify any files. This is a read-only audit.
- If the report would exceed 200 lines, focus on high and medium severity only.
- Send a one-line Telegram summary: "Lint sweep complete: X high, X medium, X low issues. Report at obsidian-vault/analysis/lint-report-YYYY-MM-DD.md"
