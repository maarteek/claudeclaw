import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentError } from './errors.js';

// Mock the SDK query function before importing agent
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

vi.mock('./env.js', () => ({
  readEnvFile: vi.fn(() => ({})),
}));

vi.mock('./config.js', () => ({
  AGENT_MAX_TURNS: 30,
  PROJECT_ROOT: '/tmp/test',
  agentCwd: undefined,
  ENABLE_ACP: true,
}));

vi.mock('./logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { runAgent, runAgentWithRetry } from './agent.js';
import { query } from '@anthropic-ai/claude-agent-sdk';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockQuery = query as any;
const noop = () => {};
const claudeProvider = { type: 'claude' as const };

async function* eventGenerator(events: object[]) {
  for (const e of events) yield e;
}

/**
 * Create a mock async iterable that yields events then closes.
 */
function mockQueryEvents(events: Array<Record<string, unknown>>) {
  return async function* () {
    for (const ev of events) {
      yield ev;
    }
  };
}

function resultEvent(text: string) {
  return {
    type: 'result',
    result: text,
    subtype: 'result',
    usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 500 },
    total_cost_usd: 0.01,
  };
}

// ── Tool-event capture ─────────────────────────────────────────────
// runAgent now consumes the provider engine's normalized event stream.
// Tool activity arrives as 'progress' events carrying the raw SDK event
// on `event.raw`; runAgent rebuilds the toolEvents buffer from there.

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

    const result = await runAgent('hi', undefined, noop, undefined, undefined, undefined, undefined, undefined, claudeProvider);
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

describe('tool_result capture', () => {
  it('matches tool_result back to tool_use via tool_use_id and sets isError correctly', async () => {
    mockQuery.mockReturnValue(eventGenerator([
      { type: 'system', subtype: 'init', session_id: 'sess-1' },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tu_1', name: 'mcp__mcp-torrent-search__search_torrents', input: {} },
            { type: 'tool_use', id: 'tu_2', name: 'Bash', input: {} },
          ],
          usage: { input_tokens: 100, cache_read_input_tokens: 0 },
        },
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_1', is_error: false, content: 'success result text' },
            { type: 'tool_result', tool_use_id: 'tu_2', is_error: true, content: 'Exit code 1\nForbidden' },
          ],
        },
      },
      { type: 'result', subtype: 'success', result: 'done' },
    ]) as any);

    const result = await runAgent('hi', undefined, noop, undefined, undefined, undefined, undefined, undefined, claudeProvider);
    expect(result.toolEvents).toHaveLength(2);
    expect(result.toolEvents[0]).toMatchObject({ toolUseId: 'tu_1', isError: false, hasResult: true });
    expect(result.toolEvents[0].resultPreview).toContain('success result');
    expect(result.toolEvents[1]).toMatchObject({ toolUseId: 'tu_2', isError: true, hasResult: true });
    expect(result.toolEvents[1].resultPreview).toContain('Exit code 1');
  });

  it('treats is_error null as non-error (matches null/false → success per verification)', async () => {
    mockQuery.mockReturnValue(eventGenerator([
      { type: 'system', subtype: 'init', session_id: 'sess-1' },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: {} }],
          usage: { input_tokens: 100, cache_read_input_tokens: 0 },
        },
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tu_1', is_error: null, content: 'file contents' }],
        },
      },
      { type: 'result', subtype: 'success', result: 'done' },
    ]) as any);

    const result = await runAgent('hi', undefined, noop, undefined, undefined, undefined, undefined, undefined, claudeProvider);
    expect(result.toolEvents[0].isError).toBe(false);
    expect(result.toolEvents[0].hasResult).toBe(true);
  });

  it('leaves hasResult=false when tool_use has no matching tool_result', async () => {
    mockQuery.mockReturnValue(eventGenerator([
      { type: 'system', subtype: 'init', session_id: 'sess-1' },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: {} }],
          usage: { input_tokens: 100, cache_read_input_tokens: 0 },
        },
      },
      // no user/tool_result event
      { type: 'result', subtype: 'success', result: 'done' },
    ]) as any);

    const result = await runAgent('hi', undefined, noop, undefined, undefined, undefined, undefined, undefined, claudeProvider);
    expect(result.toolEvents[0].hasResult).toBe(false);
  });
});

// ── Retry wrapper ──────────────────────────────────────────────────

describe('runAgentWithRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns result on first try when no error', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockQuery.mockReturnValue(mockQueryEvents([
      { type: 'system', subtype: 'init', session_id: 'sess-1' },
      resultEvent('Hello!'),
    ])() as any);

    const result = await runAgentWithRetry('hi', undefined, noop, undefined, undefined, undefined, undefined, undefined, undefined, undefined, claudeProvider);
    expect(result.text).toBe('Hello!');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable error and succeeds on second attempt', async () => {
    const retryableError = new AgentError('rate_limit', {
      shouldRetry: true,
      shouldNewChat: false,
      shouldSwitchModel: false,
      retryAfterMs: 100,
      userMessage: 'Rate limited. Retrying in 30s...',
    });

    let callCount = 0;
    mockQuery.mockImplementation(() => {
      callCount++;
      if (callCount === 1) throw retryableError;
      return mockQueryEvents([
        { type: 'system', subtype: 'init', session_id: 'sess-1' },
        resultEvent('Recovered!'),
      ])();
    });

    const onRetry = vi.fn();
    const result = await runAgentWithRetry(
      'hi', undefined, noop, undefined, undefined, undefined, undefined, onRetry, undefined, undefined, claudeProvider,
    );

    expect(result.text).toBe('Recovered!');
    expect(callCount).toBe(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.objectContaining({ category: 'rate_limit' }));
  }, 15000);

  it('does not retry non-retryable errors', async () => {
    const authError = new AgentError('auth', {
      shouldRetry: false,
      shouldNewChat: false,
      shouldSwitchModel: false,
      retryAfterMs: 0,
      userMessage: 'Auth failed',
    });

    mockQuery.mockImplementation(() => { throw authError; });

    await expect(runAgentWithRetry('hi', undefined, noop, undefined, undefined, undefined, undefined, undefined, undefined, undefined, claudeProvider)).rejects.toThrow(AgentError);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('gives up after max retries', async () => {
    const retryableError = new AgentError('subprocess_crash', {
      shouldRetry: true,
      shouldNewChat: false,
      shouldSwitchModel: false,
      retryAfterMs: 100,
      userMessage: 'Subprocess crashed',
    });

    mockQuery.mockImplementation(() => { throw retryableError; });

    const onRetry = vi.fn();
    await expect(
      runAgentWithRetry('hi', undefined, noop, undefined, undefined, undefined, undefined, onRetry, undefined, undefined, claudeProvider),
    ).rejects.toThrow(AgentError);

    // 1 initial + 2 retries = 3 total calls
    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  }, 30000);

  it('returns aborted result when abort controller is pre-aborted', async () => {
    const abortCtrl = new AbortController();
    abortCtrl.abort();

    // The SDK returns {aborted: true} when pre-aborted, runAgent returns it directly
    mockQuery.mockReturnValue(mockQueryEvents([
      { type: 'system', subtype: 'init', session_id: 'sess-1' },
      resultEvent('partial'),
    ])() as any);

    // When abort is signalled before query, runAgent catches and returns aborted
    // We mock this by having query throw the abort-detected error
    mockQuery.mockImplementation(() => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });

    const result = await runAgentWithRetry(
      'hi', undefined, noop, undefined, undefined, abortCtrl, undefined, undefined, undefined, undefined, claudeProvider,
    );
    expect(result.aborted).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('non-AgentError exceptions are classified then thrown', async () => {
    // The SDK throws a TypeError. runAgent wraps it via classifyError into an AgentError.
    mockQuery.mockImplementation(() => { throw new TypeError('unexpected'); });

    await expect(
      runAgentWithRetry('hi', undefined, noop, undefined, undefined, undefined, undefined, undefined, undefined, undefined, claudeProvider),
    ).rejects.toThrow(AgentError);
    // classifyError wraps TypeError into AgentError('unknown') which is not retryable
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('uses fallback model on shouldSwitchModel errors', async () => {
    const overloadedError = new AgentError('overloaded', {
      shouldRetry: true,
      shouldNewChat: false,
      shouldSwitchModel: true,
      retryAfterMs: 100,
      userMessage: 'Overloaded',
    });

    let callCount = 0;
    const capturedModels: (string | undefined)[] = [];
    mockQuery.mockImplementation((opts: unknown) => {
      callCount++;
      const options = (opts as Record<string, unknown>)?.options as Record<string, unknown> | undefined;
      capturedModels.push(options?.model as string | undefined);
      if (callCount === 1) throw overloadedError;
      return mockQueryEvents([
        { type: 'system', subtype: 'init', session_id: 'sess-1' },
        resultEvent('Fallback worked'),
      ])();
    });

    const result = await runAgentWithRetry(
      'hi', undefined, noop, undefined,
      'claude-opus-4-6', undefined, undefined, undefined,
      ['claude-sonnet-4-6', 'claude-haiku-4-5'], undefined, claudeProvider,
    );

    expect(result.text).toBe('Fallback worked');
    expect(capturedModels[0]).toBe('claude-opus-4-6');
    expect(capturedModels[1]).toBe('claude-sonnet-4-6');
  }, 15000);
});
