/**
 * Battle test: verify multi-agent DB isolation, hive mind, backwards compat.
 * Run: npx tsx src/battle-test.ts
 */
import {
  initDatabase, getSession, setSession, clearSession,
  createScheduledTask, getDueTasks, getAllScheduledTasks,
  saveTokenUsage, getAgentTokenStats,
  logToHiveMind, getHiveMindEntries,
  logConversationTurn,
} from './db.js';

initDatabase();

let passed = 0;
let failed = 0;
function assert(label: string, condition: boolean): void {
  if (condition) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.log(`  FAIL: ${label}`); }
}

// Test 1: Session isolation
console.log('\n--- TEST 1: Session isolation ---');
setSession('1234567890', 'main-session-123', 'main');
setSession('1234567890', 'ops-session-456', 'ops');
setSession('1234567890', 'research-session-789', 'research');

assert('Main session correct', getSession('1234567890', 'main') === 'main-session-123');
assert('Ops session correct', getSession('1234567890', 'ops') === 'ops-session-456');
assert('Research session correct', getSession('1234567890', 'research') === 'research-session-789');

clearSession('1234567890', 'ops');
assert('Ops cleared', getSession('1234567890', 'ops') === undefined);
assert('Main unaffected after ops clear', getSession('1234567890', 'main') === 'main-session-123');
assert('Research unaffected after ops clear', getSession('1234567890', 'research') === 'research-session-789');

// Test 2: Agent-scoped tasks
console.log('\n--- TEST 2: Agent-scoped tasks ---');
const ts = Date.now().toString(36);
createScheduledTask(`bt-main-${ts}`, 'main bot task', '0 9 * * *', 999999999, 'main');
createScheduledTask(`bt-ops-${ts}`, 'ops agent task', '0 10 * * *', 999999999, 'ops');
createScheduledTask(`bt-res-${ts}`, 'research task', '0 11 * * *', 999999999, 'research');

const opsTasks = getAllScheduledTasks('ops');
const resTasks = getAllScheduledTasks('research');
assert('Ops tasks >= 1', opsTasks.length >= 1);
assert('Research tasks >= 1', resTasks.length >= 1);
assert('All tasks >= 3', getAllScheduledTasks().length >= 3);
assert('Ops tasks only contain ops agent_id', opsTasks.every((t: any) => t.agent_id === 'ops'));
assert('Research tasks only contain research agent_id', resTasks.every((t: any) => t.agent_id === 'research'));

// Test 3: Token usage per agent
console.log('\n--- TEST 3: Token usage per agent ---');
saveTokenUsage('1234567890', 'sess1', 1000, 500, 800, 1000, 0.05, false, 'main');
saveTokenUsage('1234567890', 'sess2', 2000, 1000, 1600, 2000, 0.10, false, 'ops');
saveTokenUsage('1234567890', 'sess3', 500, 250, 400, 500, 0.02, false, 'research');

const mainStats = getAgentTokenStats('main');
const opsStats = getAgentTokenStats('ops');
const researchStats = getAgentTokenStats('research');
console.log(`  Main: $${mainStats.todayCost.toFixed(2)} (${mainStats.todayTurns} turns)`);
console.log(`  Ops: $${opsStats.todayCost.toFixed(2)} (${opsStats.todayTurns} turns)`);
console.log(`  Research: $${researchStats.todayCost.toFixed(2)} (${researchStats.todayTurns} turns)`);
assert('Stats isolated (main != ops cost)', mainStats.todayCost !== opsStats.todayCost);

// Test 4: Hive mind
console.log('\n--- TEST 4: Hive mind ---');
logToHiveMind('ops', '1234567890', 'scheduled_meeting', 'Booked call with John for Thu 2pm');
logToHiveMind('research', '1234567890', 'deep_research', 'Analyzed competitor pricing');
logToHiveMind('ops', '1234567890', 'sent_invoice', 'Invoice #42 to Acme Corp');

const allHive = getHiveMindEntries(10);
const opsHive = getHiveMindEntries(10, 'ops');
assert('All hive entries >= 3', allHive.length >= 3);
assert('Ops hive >= 2', opsHive.length >= 2);
assert('Newest entry is ops', allHive[0].agent_id === 'ops');
assert('Ops hive all have ops agent_id', opsHive.every((e: any) => e.agent_id === 'ops'));

// Test 5: Conversation log
console.log('\n--- TEST 5: Conversation log ---');
logConversationTurn('1234567890', 'user', 'check my calendar', 'sess1', 'ops');
logConversationTurn('1234567890', 'assistant', 'Here is your calendar...', 'sess1', 'ops');
logConversationTurn('1234567890', 'user', 'research AI trends', 'sess2', 'research');
assert('Conversation logged without error', true);

// Test 6: Backwards compat
console.log('\n--- TEST 6: Backwards compat ---');
setSession('99999', 'legacy-session');
assert('Legacy session (no agent_id) works', getSession('99999') === 'legacy-session');
clearSession('99999');
assert('Legacy clear works', getSession('99999') === undefined);

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
