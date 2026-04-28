/**
 * Patterns that indicate the assistant is proposing a state-change action.
 * When the response matches any of these, the gate fires the Gemini
 * classifier-rewriter to decide whether the proposal is grounded.
 */
export const STATE_CHANGE_PATTERNS: RegExp[] = [
  /\b(want me to|should I|shall I|do you want me to) (set|change|delete|reset|restart|remove|update|modify|disable|enable|kill|stop|drop|wipe|clear|fix|rotate|revoke) /i,
  /\b(I'?ll|I will|let me|I'?m going to) (set|change|delete|reset|restart|remove|update|modify|disable|enable|kill|stop|drop|wipe|clear|fix|rotate|revoke) /i,
  /\b(I (recommend|suggest|propose)|the fix is to|the solution is to|you (should|need to|have to)) (\w+ )?(set|change|delete|reset|restart|remove|update|modify|disable|enable|kill|stop|drop|wipe|clear|fix|rotate|revoke) /i,
];

export function isStateChangeRecommendation(text: string): boolean {
  return STATE_CHANGE_PATTERNS.some((p) => p.test(text));
}
