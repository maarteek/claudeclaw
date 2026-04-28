import { describe, it, expect, vi } from 'vitest';

// We test the tool-event capture by calling runAgent with a mocked SDK query
// that yields a controlled event sequence.

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

vi.mock('./logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('./config.js', () => ({
  PROJECT_ROOT: '/tmp',
  CLAUDECLAW_CONFIG: {},
  AGENT_ID: 'main',
  agentMcpAllowlist: undefined,
  AGENT_MAX_TURNS: 0,
  agentSystemPrompt: '',
  agentDefaultModel: undefined,
  agentObsidianConfig: null,
  agentCwd: undefined,
}));

import { query } from '@anthropic-ai/claude-agent-sdk';
import { runAgent } from './agent.js';

const mockQuery = vi.mocked(query);

async function* eventGenerator(events: object[]) {
  for (const e of events) yield e;
}

describe('tool_use capture', () => {
  it('pushes a ToolEvent for each tool_use block in an assistant message', async () => {
    mockQuery.mockReturnValue(eventGenerator([
      { type: 'system', subtype: 'init', session_id: 'sess-1' },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Searching...' },
            { type: 'tool_use', id: 'tu_1', name: 'mcp__mcp-torrent-search__search_torrents', input: { query: 'avatar' } },
          ],
          usage: { input_tokens: 100, cache_read_input_tokens: 0 },
        },
      },
      { type: 'result', subtype: 'success', result: 'done' },
    ]) as any);

    const result = await runAgent('hi', undefined, () => {});
    expect(result.toolEvents).toHaveLength(1);
    expect(result.toolEvents[0]).toMatchObject({
      toolUseId: 'tu_1',
      name: 'mcp__mcp-torrent-search__search_torrents',
      isError: false,
      hasResult: false,
      resultPreview: '',
    });
  });
});
