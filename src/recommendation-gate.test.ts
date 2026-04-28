import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./gemini.js', () => ({
  generateContent: vi.fn(),
  parseJsonResponse: vi.fn(),
}));

vi.mock('./logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { isStateChangeRecommendation, gateRecommendation } from './recommendation-gate.js';
import type { GateResult } from './recommendation-gate.js';
import { generateContent, parseJsonResponse } from './gemini.js';
import type { ToolEvent } from './agent.js';

describe('isStateChangeRecommendation', () => {
  const positives = [
    'Want me to set the qBit password to something new?',
    'Should I delete the file?',
    'Shall I restart the container?',
    'Do you want me to reset the credentials?',
    "I'll change the database setting.",
    "I will remove the entries.",
    'Let me delete those.',
    "I'm going to reset the password.",
    'I recommend we change the password.',
    'I suggest you restart the service.',
    'The fix is to reset the cache.',
    'The solution is to delete the lock file.',
    'You should rotate the credentials.',
    'You need to revoke the token.',
    'You have to disable the rule.',
  ];

  for (const phrase of positives) {
    it(`matches: "${phrase}"`, () => {
      expect(isStateChangeRecommendation(phrase)).toBe(true);
    });
  }

  const negatives = [
    'Found 12 results.',
    'The file is at /tmp/x.',
    'Done.',
    'I have already checked the credentials and they are correct.',
    'The Prowlarr stale-state bug was fixed in commit 8d29c97.',
  ];

  for (const phrase of negatives) {
    it(`does not match: "${phrase}"`, () => {
      expect(isStateChangeRecommendation(phrase)).toBe(false);
    });
  }
});

const mockGen = vi.mocked(generateContent);
const mockParse = vi.mocked(parseJsonResponse);

describe('gateRecommendation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns skip without calling Gemini when regex does not match', async () => {
    const result = await gateRecommendation('Found 12 results.', []);
    expect(result.verdict).toBe('skip');
    expect(result.response).toBe('Found 12 results.');
    expect(mockGen).not.toHaveBeenCalled();
  });

  it('returns pass when Gemini says grounded', async () => {
    mockGen.mockResolvedValue('{"is_grounded":true,"reason":"file confirmed corrupt","rewritten_response":""}');
    mockParse.mockReturnValue({ is_grounded: true, reason: 'file confirmed corrupt', rewritten_response: '' });

    const events: ToolEvent[] = [{ toolUseId: 'tu_1', name: 'Bash', isError: false, hasResult: true, resultPreview: 'file is empty' }];
    const result = await gateRecommendation('The file is corrupt. Want me to delete it?', events);

    expect(result.verdict).toBe('pass');
    expect(result.response).toBe('The file is corrupt. Want me to delete it?');
  });

  it('returns rewrite with replacement when Gemini says ungrounded (qBit fixture)', async () => {
    const rewritten = "Looking at this. I think the qBit credentials might be the issue but I haven't verified — want me to check the connection first?";
    mockGen.mockResolvedValue(`{"is_grounded":false,"reason":"no torrent-search tool call this turn","rewritten_response":${JSON.stringify(rewritten)}}`);
    mockParse.mockReturnValue({ is_grounded: false, reason: 'no torrent-search tool call this turn', rewritten_response: rewritten });

    const result = await gateRecommendation(
      'Looking at this, the qBit credentials might be the issue. Want me to set the qBit password to something new?',
      [],
    );

    expect(result.verdict).toBe('rewrite');
    expect(result.response).toBe(rewritten);
  });

  it('returns fail-open with notification on Gemini error', async () => {
    mockGen.mockRejectedValue(new Error('Gemini API down'));

    const result = await gateRecommendation('Want me to delete the file?', []);

    expect(result.verdict).toBe('fail-open');
    expect(result.response).toBe('Want me to delete the file?');
    expect(result.notification).toBeDefined();
  });

  it('returns fail-open on Gemini timeout', async () => {
    mockGen.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve('{}'), 9000)));

    const result = await gateRecommendation('Want me to delete the file?', []);

    expect(result.verdict).toBe('fail-open');
    expect(result.notification).toBeDefined();
  }, 12_000);

  it('returns fail-open on invalid JSON from Gemini', async () => {
    mockGen.mockResolvedValue('not json');
    mockParse.mockReturnValue(null);

    const result = await gateRecommendation('Want me to delete the file?', []);

    expect(result.verdict).toBe('fail-open');
  });
});
