# Telegram Digest Task

You are generating a daily digest of today's Telegram conversations between Marty and ClaudeClaw.

## Step 1: Extract conversations

Run this command to get today's conversation log:

```bash
sqlite3 -json ~/claudeclaw/store/claudeclaw.db "SELECT role, content, datetime(created_at, 'unixepoch', 'localtime') as time FROM conversation_log WHERE created_at >= unixepoch('now', '-24 hours') ORDER BY created_at ASC;"
```

If the result is empty, try 48 hours instead. If still empty, write a digest that says "No Telegram conversations in the last 48 hours."

## Step 2: Classify by project

Scan the conversations and identify which projects were discussed. Match against known project directories in ~/projects/. Common projects include: mcp-quickbooks, mcp-arthur, sparsi-financial-plan, clever-cottages, ai-os, domus-faber-land-tool, roya-6-wk-LI-sprint, hmrc-tax, cc-data-hub, mcp-hostfully, and others.

For each project mentioned, extract:
- **Decisions**: choices made, directions confirmed
- **Action items**: things Marty asked to be done, or committed to doing
- **Context**: background information, current state, blockers

Conversations that don't map to a specific project go under "General".

## Step 3: Read existing digest

Read the existing digest file if it exists:

```bash
cat ~/.claude/projects/-home-marty-projects/memory/telegram-digest.md 2>/dev/null
```

## Step 4: Write the digest

Write the digest to `~/.claude/projects/-home-marty-projects/memory/telegram-digest.md`.

Keep entries from the last 3 days (today + 2 previous). Remove anything older than 3 days.

Use this format:

```markdown
---
name: telegram-digest
description: Rolling 3-day digest of Telegram conversations classified by project. Auto-generated daily at 23:00 by ClaudeClaw.
type: project
---

# Telegram Digest

## YYYY-MM-DD

### Projects Touched
- project-name: one-line summary

### project-name
**Decisions**: ...
**Action items**: ...
**Context**: ...

### General
- Items not tied to a specific project

## YYYY-MM-DD (previous day)
...
```

Rules:
- Be concise. Each project section should be 3-8 lines max.
- Use Marty's actual words for decisions and action items where possible.
- Do not editorialize or add suggestions. Report what was discussed.
- If a voice note was transcribed, note that it was a voice message.
- Preserve technical details (IDs, amounts, dates, names) exactly.

## Step 5: Confirm

After writing the file, report to Telegram: how many conversations were processed, how many projects were touched, and the file path.
