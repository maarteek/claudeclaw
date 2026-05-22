import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db.js', () => ({
  searchMemories: vi.fn(),
  getRecentHighImportanceMemories: vi.fn(),
  getOtherAgentActivity: vi.fn(() => []),
  getConsolidationsWithEmbeddings: vi.fn(() => []),
  touchMemory: vi.fn(),
  penalizeMemory: vi.fn(),
  batchUpdateMemoryRelevance: vi.fn(),
  decayMemories: vi.fn(),
  logConversationTurn: vi.fn(),
  pruneConversationLog: vi.fn(),
  pruneWaMessages: vi.fn(() => ({ messages: 0, outbox: 0, map: 0 })),
  pruneSlackMessages: vi.fn(() => 0),
  pruneWarRoomMeetings: vi.fn(() => ({ meetings: 0, convLog: 0 })),
  searchConsolidations: vi.fn(),
  getRecentConsolidations: vi.fn(),
}));

vi.mock('./memory-ingest.js', () => ({
  ingestConversationTurn: vi.fn(() => Promise.resolve(false)),
  ingestCorrection: vi.fn(() => Promise.resolve(false)),
}));

vi.mock('./embeddings.js', () => ({
  embedText: vi.fn(() => Promise.resolve([])),
  cosineSimilarity: vi.fn(() => 0),
}));

vi.mock('./gemini.js', () => ({
  generateContent: vi.fn(() => Promise.resolve('[]')),
  parseJsonResponse: vi.fn(() => []),
}));

import {
  buildMemoryContext,
  saveConversationTurn,
  runDecaySweep,
} from './memory.js';

import {
  searchMemories,
  getRecentHighImportanceMemories,
  touchMemory,
  decayMemories,
  logConversationTurn,
  searchConsolidations,
  getRecentConsolidations,
} from './db.js';

import { ingestConversationTurn, ingestCorrection } from './memory-ingest.js';

const mockSearchMemories = vi.mocked(searchMemories);
const mockGetRecentHighImportance = vi.mocked(getRecentHighImportanceMemories);
const mockTouchMemory = vi.mocked(touchMemory);
const mockDecayMemories = vi.mocked(decayMemories);
const mockLogConversationTurn = vi.mocked(logConversationTurn);
const mockSearchConsolidations = vi.mocked(searchConsolidations);
const mockGetRecentConsolidations = vi.mocked(getRecentConsolidations);
const mockIngest = vi.mocked(ingestConversationTurn);

function makeMemory(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    chat_id: 'chat1',
    source: 'conversation',
    agent_id: 'main',
    raw_text: 'raw text',
    summary: 'A test memory',
    entities: '[]',
    topics: '[]',
    connections: '[]',
    importance: 0.7,
    salience: 1.0,
    consolidated: 0,
    pinned: 0,
    embedding: null,
    created_at: 100,
    accessed_at: 100,
    ...overrides,
  };
}

describe('buildMemoryContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchConsolidations.mockReturnValue([]);
    mockGetRecentConsolidations.mockReturnValue([]);
  });

  it('returns empty string when no memories found', async () => {
    mockSearchMemories.mockReturnValue([]);
    mockGetRecentHighImportance.mockReturnValue([]);

    const { contextText } = await buildMemoryContext('chat1', 'hello');
    expect(contextText).toBe('');
  });

  it('returns formatted string when FTS results exist', async () => {
    mockSearchMemories.mockReturnValue([
      makeMemory({ summary: 'User enjoys pizza', topics: '["food"]', importance: 0.8 }),
    ]);
    mockGetRecentHighImportance.mockReturnValue([]);

    const { contextText } = await buildMemoryContext('chat1', 'pizza');
    expect(contextText).toContain('[Memory context]');
    expect(contextText).toContain('User enjoys pizza');
    expect(contextText).toContain('food');
    expect(contextText).toContain('[0.8]');
    expect(contextText).toContain('[End memory context]');
  });

  it('deduplicates between FTS and recent results', async () => {
    const mem = makeMemory({ summary: 'shared memory' });
    mockSearchMemories.mockReturnValue([mem]);
    mockGetRecentHighImportance.mockReturnValue([mem]);

    const { contextText } = await buildMemoryContext('chat1', 'shared');
    const occurrences = contextText.split('shared memory').length - 1;
    expect(occurrences).toBe(1);
  });

  it('does NOT touch memories at retrieval (feedback loop handles this)', async () => {
    mockSearchMemories.mockReturnValue([
      makeMemory({ id: 10 }),
    ]);
    mockGetRecentHighImportance.mockReturnValue([
      makeMemory({ id: 20 }),
    ]);

    const { surfacedMemoryIds, surfacedMemorySummaries } = await buildMemoryContext('chat1', 'test');
    expect(mockTouchMemory).not.toHaveBeenCalled();
    expect(surfacedMemoryIds).toContain(10);
    expect(surfacedMemoryIds).toContain(20);
    expect(surfacedMemorySummaries.get(10)).toBe('A test memory');
  });
});

describe('saveConversationTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs both user and assistant messages to conversation log', () => {
    saveConversationTurn('chat1', 'hello world from the user!!!', 'Noted.');
    expect(mockLogConversationTurn).toHaveBeenCalledWith('chat1', 'user', 'hello world from the user!!!', undefined, 'main');
    expect(mockLogConversationTurn).toHaveBeenCalledWith('chat1', 'assistant', 'Noted.', undefined, 'main');
  });

  it('fires async ingestion', () => {
    saveConversationTurn('chat1', 'I prefer TypeScript over JavaScript always and forever', 'Noted.');
    expect(mockIngest).toHaveBeenCalledWith('chat1', 'I prefer TypeScript over JavaScript always and forever', 'Noted.', 'main');
  });
});

describe('buildMemoryContext with consolidations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchMemories.mockReturnValue([]);
    mockGetRecentHighImportance.mockReturnValue([]);
  });

  it('includes consolidation insights when searchConsolidations returns results', async () => {
    mockSearchConsolidations.mockReturnValue([
      { id: 1, chat_id: 'chat1', source_ids: '[1,2]', summary: 'Morning routine synthesis', insight: 'User has structured morning workflow', created_at: 100 },
    ]);

    const { contextText } = await buildMemoryContext('chat1', 'morning routine');
    expect(contextText).toContain('Insights:');
    expect(contextText).toContain('User has structured morning workflow');
  });

  it('falls back to recent consolidations when search returns empty', async () => {
    mockSearchConsolidations.mockReturnValue([]);
    mockGetRecentConsolidations.mockReturnValue([
      { id: 1, chat_id: 'chat1', source_ids: '[1]', summary: 'General insight', insight: 'User values productivity', created_at: 100 },
    ]);

    const { contextText } = await buildMemoryContext('chat1', 'unrelated query');
    expect(contextText).toContain('User values productivity');
  });

  it('returns empty when no memories and no insights exist', async () => {
    mockSearchConsolidations.mockReturnValue([]);
    mockGetRecentConsolidations.mockReturnValue([]);

    const { contextText } = await buildMemoryContext('chat1', 'anything');
    expect(contextText).toBe('');
  });

  it('includes both memories and insights when both exist', async () => {
    mockSearchMemories.mockReturnValue([
      makeMemory({ summary: 'Prefers dark mode', importance: 0.8, topics: '["UI"]' }),
    ]);
    mockSearchConsolidations.mockReturnValue([
      { id: 1, chat_id: 'chat1', source_ids: '[1]', summary: 'UI summary', insight: 'User cares deeply about UI aesthetics', created_at: 100 },
    ]);

    const { contextText } = await buildMemoryContext('chat1', 'UI preferences');
    expect(contextText).toContain('Prefers dark mode');
    expect(contextText).toContain('User cares deeply about UI aesthetics');
    expect(contextText).toContain('Relevant memories:');
    expect(contextText).toContain('Insights:');
  });
});

describe('buildMemoryContext topic formatting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchConsolidations.mockReturnValue([]);
    mockGetRecentConsolidations.mockReturnValue([]);
  });

  it('includes parsed topics in the formatted output', async () => {
    mockSearchMemories.mockReturnValue([
      makeMemory({ summary: 'Likes hiking', topics: '["outdoor", "fitness"]', importance: 0.7 }),
    ]);
    mockGetRecentHighImportance.mockReturnValue([]);

    const { contextText } = await buildMemoryContext('chat1', 'hiking');
    expect(contextText).toContain('outdoor');
    expect(contextText).toContain('fitness');
  });

  it('handles empty topics gracefully', async () => {
    mockSearchMemories.mockReturnValue([
      makeMemory({ summary: 'No topics memory', topics: '[]', importance: 0.6 }),
    ]);
    mockGetRecentHighImportance.mockReturnValue([]);

    const { contextText } = await buildMemoryContext('chat1', 'query');
    expect(contextText).toContain('No topics memory');
    // Should not have trailing topic parentheses
    expect(contextText).not.toContain('()');
  });

  it('handles malformed topics JSON gracefully', async () => {
    mockSearchMemories.mockReturnValue([
      makeMemory({ summary: 'Bad topics', topics: 'not-json', importance: 0.6 }),
    ]);
    mockGetRecentHighImportance.mockReturnValue([]);

    const { contextText } = await buildMemoryContext('chat1', 'query');
    expect(contextText).toContain('Bad topics');
    // Should not crash
  });
});

describe('runDecaySweep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls decayMemories once', () => {
    runDecaySweep();
    expect(mockDecayMemories).toHaveBeenCalledOnce();
  });
});

describe('Memory 47 regression — pinned high-importance memory still surfaces', () => {
  // Seed a memory shaped like the real production memory id=47:
  // TorrentLeech / qBit / Prowlarr correction, importance=1.0, pinned=1.
  // These tests lock in buildMemoryContext's contract: a pinned high-importance
  // memory MUST surface both via Layer 1 (keyword match) and Layer 2 (high-importance
  // sweep), so future refactors cannot silently break the correction-retrieval path.

  const mem47 = makeMemory({
    id: 47,
    chat_id: 'chat-47',
    source: 'correction',
    summary: 'TorrentLeech and qBit credentials are CORRECT. Stale-state Prowlarr bug fixed by self-heal in commit 8d29c97.',
    raw_text: 'TorrentLeech and qBit credentials are CORRECT. Intermittent fetch_failed errors on TL grabs are a Prowlarr 2.3.5.5327 stale-state bug, fixed by self-heal.',
    entities: '["torrentleech","qbit","prowlarr"]',
    topics: '["credentials","troubleshooting"]',
    importance: 1.0,
    pinned: 1,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchConsolidations.mockReturnValue([]);
    mockGetRecentConsolidations.mockReturnValue([]);
  });

  it('surfaces a pinned memory with importance=1.0 when the query keyword matches (Layer 1)', async () => {
    // Layer 1: searchMemories returns the memory because "torrent leech" matches keywords
    mockSearchMemories.mockReturnValue([mem47]);
    mockGetRecentHighImportance.mockReturnValue([]);

    const result = await buildMemoryContext('chat-47', 'why did the torrent leech grab fail last night?', 'main');

    expect(result.surfacedMemoryIds).toContain(47);
    expect(result.contextText).toContain('TorrentLeech');
  });

  it('surfaces the pinned memory via high-importance Layer 2 even without keyword match', async () => {
    // Layer 1 returns nothing (query "what time is it?" has no keyword overlap).
    // Layer 2 (getRecentHighImportanceMemories) returns the pinned memory because
    // importance=1.0 >= 0.5 threshold.
    mockSearchMemories.mockReturnValue([]);
    mockGetRecentHighImportance.mockReturnValue([mem47]);

    const result = await buildMemoryContext('chat-47', 'what time is it?', 'main');

    expect(result.surfacedMemoryIds).toContain(47);
  });
});

describe('saveConversationTurn fires both extractors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fires ingestConversationTurn AND ingestCorrection in parallel', async () => {
    saveConversationTurn('chat-1', 'user msg', 'assistant resp', 'sess-1', 'main');

    // Allow microtasks for the fire-and-forget calls
    await new Promise((r) => setTimeout(r, 10));

    expect(vi.mocked(ingestConversationTurn)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ingestCorrection)).toHaveBeenCalledWith('chat-1', 'user msg', 'main');
  });
});
