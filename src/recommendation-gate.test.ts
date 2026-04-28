import { describe, it, expect, vi } from 'vitest';

vi.mock('./gemini.js', () => ({
  generateContent: vi.fn(),
  parseJsonResponse: vi.fn(),
}));

vi.mock('./logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { isStateChangeRecommendation } from './recommendation-gate.js';

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
