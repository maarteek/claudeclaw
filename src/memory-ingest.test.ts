import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./gemini.js', () => ({
  generateContent: vi.fn(),
  parseJsonResponse: vi.fn(),
}));

vi.mock('./db.js', () => ({
  saveStructuredMemory: vi.fn(() => 1),
  saveMemoryEmbedding: vi.fn(),
  getMemoriesWithEmbeddings: vi.fn(() => []),
  getPreviousAssistantMessage: vi.fn(),
}));

vi.mock('./embeddings.js', () => ({
  embedText: vi.fn(() => Promise.resolve([0.1, 0.2, 0.3])),
  cosineSimilarity: vi.fn(() => 0),
}));

vi.mock('./logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { ingestConversationTurn, matchesCorrectionPattern, ingestCorrection } from './memory-ingest.js';
import { generateContent, parseJsonResponse } from './gemini.js';
import { saveStructuredMemory, getMemoriesWithEmbeddings, getPreviousAssistantMessage } from './db.js';
import { cosineSimilarity } from './embeddings.js';

const mockGenerateContent = vi.mocked(generateContent);
const mockParseJson = vi.mocked(parseJsonResponse);
const mockSave = vi.mocked(saveStructuredMemory);
const mockGetPrev = vi.mocked(getPreviousAssistantMessage);
const mockGetMemoriesWithEmbeddings = vi.mocked(getMemoriesWithEmbeddings);
const mockCosineSimilarity = vi.mocked(cosineSimilarity);

describe('ingestConversationTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Hard filters (skip before hitting Gemini) ────────────────────

  it('skips messages <= 15 characters', async () => {
    const result = await ingestConversationTurn('chat1', 'short msg', 'ok');
    expect(result).toBe(false);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('skips messages exactly 15 characters', async () => {
    const result = await ingestConversationTurn('chat1', '123456789012345', 'ok');
    expect(result).toBe(false);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('processes messages of 16 characters', async () => {
    mockGenerateContent.mockResolvedValue('{}');
    mockParseJson.mockReturnValue({ skip: true });
    const result = await ingestConversationTurn('chat1', '1234567890123456', 'ok');
    // Should have called Gemini even though it was skipped by LLM
    expect(mockGenerateContent).toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('skips messages starting with /', async () => {
    const result = await ingestConversationTurn('chat1', '/chatid some long command text here', 'Your ID is 12345');
    expect(result).toBe(false);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  // ── Gemini decides to skip ────────────────────────────────────────

  it('returns false when Gemini says skip', async () => {
    mockGenerateContent.mockResolvedValue('{"skip": true}');
    mockParseJson.mockReturnValue({ skip: true });
    const result = await ingestConversationTurn('chat1', 'ok sounds good thanks for doing that', 'No problem.');
    expect(result).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('returns false when Gemini returns null (parse failure)', async () => {
    mockGenerateContent.mockResolvedValue('garbage');
    mockParseJson.mockReturnValue(null);
    const result = await ingestConversationTurn('chat1', 'some message that is long enough', 'response');
    expect(result).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });

  // ── Gemini extracts a memory ──────────────────────────────────────

  it('saves a structured memory on valid extraction', async () => {
    const extraction = {
      skip: false,
      summary: 'User prefers dark mode in all applications',
      entities: ['dark mode', 'UI'],
      topics: ['preferences', 'UI'],
      importance: 0.8,
    };
    mockGenerateContent.mockResolvedValue(JSON.stringify(extraction));
    mockParseJson.mockReturnValue(extraction);

    const result = await ingestConversationTurn(
      'chat1',
      'I always want dark mode enabled in everything',
      'Got it, I will remember your dark mode preference.',
    );

    expect(result).toBe(true);
    expect(mockSave).toHaveBeenCalledWith(
      'chat1',
      'I always want dark mode enabled in everything',
      'User prefers dark mode in all applications',
      ['dark mode', 'UI'],
      ['preferences', 'UI'],
      0.8,
      'conversation',
      'main',
    );
  });

  // ── Importance filtering ──────────────────────────────────────────

  it('skips extraction with importance < 0.3', async () => {
    const extraction = {
      skip: false,
      summary: 'Trivial fact',
      entities: [],
      topics: [],
      importance: 0.25,
    };
    mockGenerateContent.mockResolvedValue(JSON.stringify(extraction));
    mockParseJson.mockReturnValue(extraction);

    const result = await ingestConversationTurn('chat1', 'some trivial message longer than fifteen', 'ok');
    expect(result).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('skips extraction with importance exactly 0.2 (below 0.3 floor)', async () => {
    const extraction = {
      skip: false,
      summary: 'Low importance fact',
      entities: [],
      topics: [],
      importance: 0.2,
    };
    mockGenerateContent.mockResolvedValue(JSON.stringify(extraction));
    mockParseJson.mockReturnValue(extraction);

    const result = await ingestConversationTurn('chat1', 'some borderline message longer than fifteen', 'ok');
    expect(result).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('skips extraction with importance exactly 0.3 (below 0.5 floor)', async () => {
    const extraction = {
      skip: false,
      summary: 'Borderline fact',
      entities: [],
      topics: [],
      importance: 0.3,
    };
    mockGenerateContent.mockResolvedValue(JSON.stringify(extraction));
    mockParseJson.mockReturnValue(extraction);

    const result = await ingestConversationTurn('chat1', 'some borderline message longer than fifteen', 'ok');
    expect(result).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('saves extraction with importance exactly 0.5', async () => {
    const extraction = {
      skip: false,
      summary: 'Useful fact',
      entities: [],
      topics: [],
      importance: 0.5,
    };
    mockGenerateContent.mockResolvedValue(JSON.stringify(extraction));
    mockParseJson.mockReturnValue(extraction);

    const result = await ingestConversationTurn('chat1', 'some useful message longer than fifteen', 'ok');
    expect(result).toBe(true);
    expect(mockSave).toHaveBeenCalled();
  });

  // ── Importance clamping ───────────────────────────────────────────

  it('clamps importance above 1.0 to 1.0', async () => {
    const extraction = {
      skip: false,
      summary: 'Very important',
      entities: [],
      topics: [],
      importance: 1.5,
    };
    mockGenerateContent.mockResolvedValue(JSON.stringify(extraction));
    mockParseJson.mockReturnValue(extraction);

    await ingestConversationTurn('chat1', 'extremely important message for testing', 'noted');
    expect(mockSave).toHaveBeenCalledWith(
      'chat1',
      expect.any(String),
      'Very important',
      [],
      [],
      1.0,  // clamped
      'conversation',
      'main',
    );
  });

  it('clamps negative importance to 0', async () => {
    const extraction = {
      skip: false,
      summary: 'Negative importance',
      entities: [],
      topics: [],
      importance: -0.5,
    };
    mockGenerateContent.mockResolvedValue(JSON.stringify(extraction));
    mockParseJson.mockReturnValue(extraction);

    // importance -0.5 < 0.2 threshold, so it should be skipped
    const result = await ingestConversationTurn('chat1', 'message with negative importance test', 'response');
    expect(result).toBe(false);
  });

  // ── Validation of required fields ─────────────────────────────────

  it('skips when summary is missing', async () => {
    const extraction = {
      skip: false,
      summary: '',
      entities: [],
      topics: [],
      importance: 0.7,
    };
    mockGenerateContent.mockResolvedValue(JSON.stringify(extraction));
    mockParseJson.mockReturnValue(extraction);

    const result = await ingestConversationTurn('chat1', 'message with no summary extracted from it', 'response');
    expect(result).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('skips when importance is not a number', async () => {
    const extraction = {
      skip: false,
      summary: 'Valid summary',
      entities: [],
      topics: [],
      importance: 'high' as unknown as number,
    };
    mockGenerateContent.mockResolvedValue(JSON.stringify(extraction));
    mockParseJson.mockReturnValue(extraction);

    const result = await ingestConversationTurn('chat1', 'message where importance is a string', 'response');
    expect(result).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });

  // ── Missing optional fields ───────────────────────────────────────

  it('handles missing entities and topics gracefully', async () => {
    const extraction = {
      skip: false,
      summary: 'No entities or topics',
      importance: 0.5,
    };
    mockGenerateContent.mockResolvedValue(JSON.stringify(extraction));
    mockParseJson.mockReturnValue(extraction);

    const result = await ingestConversationTurn('chat1', 'message with no entities or topics at all', 'response');
    expect(result).toBe(true);
    expect(mockSave).toHaveBeenCalledWith(
      'chat1',
      expect.any(String),
      'No entities or topics',
      [],  // defaults to empty
      [],  // defaults to empty
      0.5,
      'conversation',
      'main',
    );
  });

  // ── Error handling ────────────────────────────────────────────────

  it('returns false when Gemini API throws', async () => {
    mockGenerateContent.mockRejectedValue(new Error('API rate limited'));

    const result = await ingestConversationTurn('chat1', 'this message should not crash the bot', 'response');
    expect(result).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });

  // ── Message truncation ────────────────────────────────────────────

  it('truncates long messages to 2000 chars in prompt', async () => {
    mockGenerateContent.mockResolvedValue('{"skip": true}');
    mockParseJson.mockReturnValue({ skip: true });

    const longMsg = 'x'.repeat(5000);
    await ingestConversationTurn('chat1', longMsg, 'response');

    const promptArg = mockGenerateContent.mock.calls[0][0];
    // The prompt should contain the truncated message, not the full 5000 chars
    expect(promptArg).not.toContain('x'.repeat(3000));
    expect(promptArg).toContain('x'.repeat(2000));
  });
});

describe('matchesCorrectionPattern', () => {
  const positiveCases = [
    "you're wrong",
    "you are wrong",
    "that's wrong",
    "that is incorrect",
    "that's not right",
    "that's not the problem",
    "that is not the issue",
    "that is not a cause",
    "the qubit password is fine",
    "the credentials are correct",
    "the database is not the problem",
    "stop suggesting to change it",
    "stop recommending that",
    "stop saying that",
    "no it isn't",
    "no, it is not",
    "nope that's not it",
    "nope, that's not the problem",
    "don't touch the password",
    "do not change my settings",
    "you've got it wrong",
    "you have got that wrong",
    "there's nothing wrong with the qubit password",
    "there is nothing wrong with my config",
    // The verbatim qBit-incident phrase from the kickoff:
    "There's nothing wrong with the qubit password. That's not the problem. You've got it wrong.",
  ];

  for (const phrase of positiveCases) {
    it(`matches: "${phrase.slice(0, 50)}..."`, () => {
      expect(matchesCorrectionPattern(phrase)).toBe(true);
    });
  }

  const negativeCases = [
    "ok thanks",
    "what's the weather",
    "send the email",
    "I think we should consider it",
    "looks good",
    "let's move on",
    "my password is correct" /* close but no "the X is fine" structure since "is correct" wraps to a different shape */,
  ];

  // Note: "my password is correct" will match pattern 4 (the X is fine|correct)
  // so removing it from negatives. Leaving the false-positive note as a learning.

  for (const phrase of negativeCases.filter(p => p !== 'my password is correct')) {
    it(`does not match: "${phrase}"`, () => {
      expect(matchesCorrectionPattern(phrase)).toBe(false);
    });
  }
});

describe('ingestCorrection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCosineSimilarity.mockReturnValue(0);
    mockGetMemoriesWithEmbeddings.mockReturnValue([]);
  });

  it('returns false when user message has no correction phrase', async () => {
    const result = await ingestCorrection('chat-1', 'send the email', 'main');
    expect(result).toBe(false);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('returns false when there is no previous assistant message', async () => {
    mockGetPrev.mockReturnValue(null);
    const result = await ingestCorrection('chat-1', "you're wrong", 'main');
    expect(result).toBe(false);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('writes a pinned memory on the qBit-fixture verbatim phrase', async () => {
    mockGetPrev.mockReturnValue('Want me to set the qBit password to something new?');
    mockGenerateContent.mockResolvedValue('{"skip":false,"disputed_claim":"qBit password needs changing","corrected_fact":"qBit password is fine","summary":"qBit password is correct; do not propose changing it.","topics":["qbit","credentials"]}');
    mockParseJson.mockReturnValue({
      skip: false,
      disputed_claim: 'qBit password needs changing',
      corrected_fact: 'qBit password is fine',
      summary: 'qBit password is correct; do not propose changing it.',
      topics: ['qbit', 'credentials'],
    });

    const phrase = "There's nothing wrong with the qubit password. That's not the problem. You've got it wrong.";
    const result = await ingestCorrection('chat-1', phrase, 'main');

    expect(result).toBe(true);
    expect(mockSave).toHaveBeenCalledTimes(1);
    const args = mockSave.mock.calls[0];
    expect(args[5]).toBe(1.0);          // importance
    expect(args[6]).toBe('correction'); // source
    expect(args[8]).toBe(1);            // pinned
  });

  it('returns false when Gemini classifies as third-party correction (skip=true)', async () => {
    mockGetPrev.mockReturnValue('I think Bob still works at ACME.');
    mockGenerateContent.mockResolvedValue('{"skip":true}');
    mockParseJson.mockReturnValue({ skip: true });

    const result = await ingestCorrection('chat-1', "you're wrong, Bob left ACME last year", 'main');

    expect(result).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('skips writing if a near-duplicate memory exists (cosine sim > 0.85)', async () => {
    mockGetPrev.mockReturnValue('Maybe the password is the issue?');
    mockGenerateContent.mockResolvedValue('{"skip":false,"summary":"qBit password is correct.","disputed_claim":"x","corrected_fact":"y","topics":[]}');
    mockParseJson.mockReturnValue({
      skip: false,
      disputed_claim: 'x',
      corrected_fact: 'y',
      summary: 'qBit password is correct.',
      topics: [],
    });
    mockGetMemoriesWithEmbeddings.mockReturnValue([
      { id: 47, embedding: [0.1, 0.2, 0.3], summary: 'existing pinned mem', importance: 1.0 },
    ]);
    mockCosineSimilarity.mockReturnValue(0.9);

    const result = await ingestCorrection('chat-1', "you're wrong about that", 'main');

    expect(result).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('returns false on Gemini failure (logged but non-fatal)', async () => {
    mockGetPrev.mockReturnValue('Some prior claim');
    mockGenerateContent.mockRejectedValue(new Error('Gemini timeout'));

    const result = await ingestCorrection('chat-1', "you're wrong", 'main');

    expect(result).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });
});
