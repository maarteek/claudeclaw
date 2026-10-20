#!/usr/bin/env node
/**
 * ClaudeClaw Session Reset CLI
 *
 * Clears every stored agent session so the next message starts fresh.
 * Run by the nightly restart (before the units restart) so a chat session
 * cannot drift for months through repeated compaction.
 *
 * Usage:
 *   node dist/session-reset-cli.js
 */

import { initDatabase, clearAllSessions, logToHiveMind } from './db.js';

initDatabase();

const cleared = clearAllSessions();

for (const row of cleared) {
  logToHiveMind(
    row.agent_id,
    row.chat_id,
    'session_end',
    `Nightly reset cleared session ${row.session_id} (last active ${row.updated_at}).`,
  );
  console.log(`cleared ${row.agent_id} chat=${row.chat_id} session=${row.session_id} last=${row.updated_at}`);
}

console.log(`${cleared.length} session(s) cleared`);
