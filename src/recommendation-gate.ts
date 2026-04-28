import { generateContent, parseJsonResponse } from './gemini.js';
import { logger } from './logger.js';
import type { ToolEvent } from './agent.js';

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

export type GateVerdict = 'skip' | 'pass' | 'rewrite' | 'fail-open';

export interface GateResult {
  verdict: GateVerdict;
  response: string;
  notification?: string;
}

const GATE_PROMPT = `You are a safety gate for an AI assistant. The assistant just sent a
response that contains a state-change recommendation. Decide whether the
recommendation is grounded in a successful tool call from this same turn.

A recommendation is GROUNDED if a tool result earlier in the same turn
provides direct evidence that the proposed change is needed. Examples:
- "Want me to delete file X?" after a tool call confirmed file X is malformed: GROUNDED
- "Want me to reset the password?" with no relevant tool call this turn: NOT GROUNDED

Tool calls in this turn:
{TOOL_EVENTS}

Assistant response:
{RESPONSE}

Return JSON:
{
  "is_grounded": true | false,
  "reason": "one short sentence",
  "rewritten_response": "if not grounded, rewrite the response keeping all factual content but replacing the recommendation with a clarifying question like 'I think X but I haven't verified — want me to check first?'. If grounded, copy the original response."
}`;

const GATE_TIMEOUT_MS = 8000;

export async function gateRecommendation(
  response: string,
  toolEvents: ToolEvent[],
): Promise<GateResult> {
  // Stage 1: regex pre-filter
  if (!isStateChangeRecommendation(response)) {
    return { verdict: 'skip', response };
  }

  // Stage 2: fused classifier-rewriter
  try {
    const toolList = toolEvents.length === 0
      ? '(no tool calls this turn)'
      : toolEvents.map((t) => {
          const status = t.isError ? '(ERROR)' : t.hasResult ? '(success)' : '(no result yet)';
          return `- ${t.name} ${status}: ${t.resultPreview.slice(0, 100)}`;
        }).join('\n');

    const prompt = GATE_PROMPT.replace('{TOOL_EVENTS}', toolList).replace('{RESPONSE}', response);

    const timeoutPromise = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('Gate timeout')), GATE_TIMEOUT_MS),
    );
    const raw = await Promise.race([generateContent(prompt), timeoutPromise]);
    const parsed = parseJsonResponse<{ is_grounded: boolean; reason: string; rewritten_response: string }>(raw);

    if (!parsed || typeof parsed.is_grounded !== 'boolean') {
      logger.warn({ raw: typeof raw === 'string' ? raw.slice(0, 200) : raw }, 'Recommendation gate returned invalid JSON');
      return { verdict: 'fail-open', response, notification: 'recommendation gate returned invalid JSON, response sent unchecked' };
    }

    if (parsed.is_grounded) {
      return { verdict: 'pass', response };
    }

    return { verdict: 'rewrite', response: parsed.rewritten_response || response };
  } catch (err) {
    logger.warn({ err }, 'Recommendation gate failed');
    return { verdict: 'fail-open', response, notification: 'recommendation gate failed, response sent unchecked' };
  }
}
