import { generateContent, parseJsonResponse } from './gemini.js';
import { cosineSimilarity, embedText } from './embeddings.js';
import { getMemoriesWithEmbeddings, saveStructuredMemory, saveMemoryEmbedding, getPreviousAssistantMessage } from './db.js';
import { logger } from './logger.js';

/**
 * Hardline correction phrases. When a user message matches any of these,
 * it triggers the specialised correction extractor (ingestCorrection),
 * which writes a pinned high-importance memory linking the disputed claim
 * to the corrected fact.
 *
 * Patterns added over time as new failure modes are observed.
 */
export const CORRECTION_PATTERNS: RegExp[] = [
  /\byou('?re| are) wrong\b/i,
  /\bthat('?s| is) (wrong|incorrect|not right)\b/i,
  /\bthat('?s| is) not (the|a) (problem|issue|cause)\b/i,
  /\bthe \w[\w\s]{1,40}? (is|are) (fine|correct|not the (issue|problem|cause))\b/i,
  /\bstop (suggesting|recommending|saying|proposing|trying) (to|that)?\b/i,
  /\bno,? it (isn'?t|is not)\b/i,
  /\bnope,? that('?s| is) not (it|right|the (problem|issue))\b/i,
  /\b(don'?t|do not) (touch|change|reset|modify|update) (the|my|our|that) \w/i,
  /\byou('?ve| have) got (it|that|this) wrong\b/i,
  /\bthere('?s| is) nothing wrong with (the|my|our|that) \w/i,
];

export function matchesCorrectionPattern(text: string): boolean {
  return CORRECTION_PATTERNS.some((p) => p.test(text));
}

// Callback for notifying when a high-importance memory is created.
// Set by bot.ts to send a Telegram notification.
let onHighImportanceMemory: ((memoryId: number, summary: string, importance: number) => void) | null = null;

export function setHighImportanceCallback(cb: (memoryId: number, summary: string, importance: number) => void): void {
  onHighImportanceMemory = cb;
}

interface ExtractionResult {
  summary: string;
  entities: string[];
  topics: string[];
  importance: number;
}

const EXTRACTION_PROMPT = `You are a memory extraction agent. Given a conversation exchange between a user and their AI assistant, decide if it contains information worth remembering LONG-TERM (weeks/months from now).

The bar is HIGH. Most exchanges should be skipped. Only extract if a future conversation would go noticeably worse without this memory.

SKIP (return {"skip": true}) if:
- The message is just an acknowledgment (ok, yes, no, got it, thanks, send it, do it)
- It's a command with no lasting context (/chatid, /help, checkpoint, convolife, etc)
- It's ephemeral task execution (send this email, check my calendar, read this message, draft a response, move these emails, fill out this form)
- The content is only relevant to this exact moment or this session
- It's a greeting or small talk with no substance
- It's a one-off action request like "shorten that", "generate 3 ideas", "look up X", "draft a reply"
- It's a correction of a typo or minor instruction adjustment
- It's asking for information or a status check ("how much did we make", "what's trending", "what time is it")
- The assistant is SUMMARIZING what it just did ("I sent the messages", "Here's what I moved", "Done, here's your inbox")
- The assistant is SUMMARIZING the session or recapping prior conversation. Session summaries are meta-information, not new facts.
- It's form-filling, application steps, or draft iteration that won't matter once the form is submitted
- It describes what the assistant sent/did/moved/drafted for the user (these are task logs, not memories)
- The exchange is about a specific person's one-time message or request that won't recur

EXTRACT only if the exchange reveals:
- User preferences or habits that apply GOING FORWARD (not just this one time)
- Decisions or policies (how to handle X from now on)
- Important relationships: WHO someone is and HOW the user relates to them (not what they said in one message)
- Corrections to the assistant's behavior (feedback on approach)
- Business rules or workflows that are STANDING RULES
- Recurring patterns or routines
- Technical preferences or architectural decisions

If extracting, return JSON:
{
  "skip": false,
  "summary": "1-2 sentence summary focused on the LASTING FACT, not the conversation. Write as a rule or fact, not a narrative.",
  "entities": ["entity1", "entity2"],
  "topics": ["topic1", "topic2"],
  "importance": 0.0-1.0
}

Importance guide:
- 0.8-1.0: Core identity, strong preferences, critical business rules, relationship dynamics
- 0.5-0.7: Useful context, standing project decisions, moderate preferences, workflow patterns
- 0.3-0.4: Borderline. If in doubt, skip. Only extract if you are confident this will matter in a future session.

User message: {USER_MESSAGE}
Assistant response: {ASSISTANT_RESPONSE}`;

/**
 * Analyze a conversation turn and extract structured memory if warranted.
 * Called async (fire-and-forget) after the assistant responds.
 * Returns true if a memory was saved, false if skipped.
 */
export async function ingestConversationTurn(
  chatId: string,
  userMessage: string,
  assistantResponse: string,
  agentId = 'main',
): Promise<boolean> {
  // Hard filter: skip very short messages and commands
  if (userMessage.length <= 15 || userMessage.startsWith('/')) return false;

  // Short-circuit on corrections — let ingestCorrection handle them exclusively
  // to avoid cross-extractor duplication. ingestCorrection runs in parallel
  // (see saveConversationTurn in memory.ts).
  if (matchesCorrectionPattern(userMessage)) return false;

  try {
    const prompt = EXTRACTION_PROMPT
      .replace('{USER_MESSAGE}', userMessage.slice(0, 2000))
      .replace('{ASSISTANT_RESPONSE}', assistantResponse.slice(0, 2000));

    const raw = await generateContent(prompt);
    const result = parseJsonResponse<ExtractionResult & { skip?: boolean }>(raw);

    if (!result || result.skip) return false;

    // Validate required fields
    if (!result.summary || typeof result.importance !== 'number') {
      logger.warn({ result }, 'Gemini extraction missing required fields');
      return false;
    }

    // Hard filter: only save memories with meaningful importance.
    // 0.5 threshold ensures only genuinely useful context gets through.
    // The 0.3-0.4 tier was almost entirely noise (task logs, form steps).
    if (result.importance < 0.5) return false;

    // Clamp importance to valid range
    const importance = Math.max(0, Math.min(1, result.importance));

    // Generate embedding early so we can check for duplicates before saving
    let embedding: number[] = [];
    try {
      const embeddingText = `${result.summary} ${(result.entities ?? []).join(' ')} ${(result.topics ?? []).join(' ')}`;
      embedding = await embedText(embeddingText);
    } catch (embErr) {
      logger.warn({ err: embErr }, 'Failed to generate embedding for duplicate check');
    }

    // Duplicate detection: skip if a very similar memory already exists
    if (embedding.length > 0) {
      const existing = getMemoriesWithEmbeddings(chatId);
      for (const mem of existing) {
        const sim = cosineSimilarity(embedding, mem.embedding);
        if (sim > 0.85) {
          logger.debug(
            { similarity: sim.toFixed(3), existingId: mem.id, newSummary: result.summary.slice(0, 60) },
            'Skipping duplicate memory',
          );
          return false;
        }
      }
    }

    const memoryId = saveStructuredMemory(
      chatId,
      userMessage,
      result.summary,
      result.entities ?? [],
      result.topics ?? [],
      importance,
      'conversation',
      agentId,
    );

    // Store the embedding we already generated
    if (embedding.length > 0) {
      saveMemoryEmbedding(memoryId, embedding);
    }

    // Notify on high-importance memories so the user can pin them
    if (importance >= 0.8 && onHighImportanceMemory) {
      try { onHighImportanceMemory(memoryId, result.summary, importance); } catch { /* non-fatal */ }
    }

    logger.info(
      { chatId, importance, memoryId, topics: result.topics, summary: result.summary.slice(0, 80) },
      'Memory ingested',
    );
    return true;
  } catch (err) {
    // Gemini failure should never block the bot
    logger.error({ err }, 'Memory ingestion failed (Gemini)');
    return false;
  }
}

const CORRECTION_EXTRACTION_PROMPT = `The user has just used a phrase that suggests they are correcting the
assistant. Decide whether they are actually correcting a claim YOU
(the assistant) made in your previous message, vs. talking about a
third party or unrelated fact.

Previous assistant message:
{PREV}

User's correction:
{USER}

If the user is NOT correcting your prior claim (e.g. they are correcting
a fact about a third party that you happened to mention, or they are
just venting), return:
{"skip": true}

If the user IS correcting a claim you made, extract:
{
  "skip": false,
  "disputed_claim": "the claim you made that they are disputing",
  "corrected_fact": "the corrected truth per the user",
  "summary": "one-sentence durable rule, written as: 'X is correct, not Y' or 'Never assume Z; check W instead'",
  "topics": ["topic1", "topic2"]
}

The summary becomes a durable memory that surfaces in future sessions, so write it as a clear factual rule, not as a narrative of the exchange.`;

interface CorrectionExtractionResult {
  skip?: boolean;
  disputed_claim?: string;
  corrected_fact?: string;
  summary?: string;
  topics?: string[];
}

/**
 * Detect a user correction and write a pinned high-importance memory
 * linking the disputed claim to the corrected fact.
 *
 * Two-stage pipeline:
 *   1. Regex pre-filter on user message (cheap, deterministic)
 *   2. Specialised Gemini call to extract the disputed claim and the rule
 *
 * Runs in parallel with the existing ingestConversationTurn extractor;
 * both writes are independent. Fire-and-forget at the call site.
 */
export async function ingestCorrection(
  chatId: string,
  userMessage: string,
  agentId = 'main',
): Promise<boolean> {
  // Stage 1: regex pre-filter
  if (!matchesCorrectionPattern(userMessage)) return false;

  // Stage 2: fetch previous assistant message
  const prev = getPreviousAssistantMessage(chatId, agentId);
  if (!prev) return false;

  try {
    const prompt = CORRECTION_EXTRACTION_PROMPT
      .replace('{PREV}', prev.slice(0, 2000))
      .replace('{USER}', userMessage.slice(0, 2000));

    const raw = await generateContent(prompt);
    const result = parseJsonResponse<CorrectionExtractionResult>(raw);

    if (!result || result.skip) return false;
    if (!result.summary) {
      logger.warn({ result }, 'Correction extraction missing summary');
      return false;
    }

    // Embed for duplicate detection (matches existing extractor)
    let embedding: number[] = [];
    try {
      const embeddingText = `${result.summary} ${(result.topics ?? []).join(' ')}`;
      embedding = await embedText(embeddingText);
    } catch (embErr) {
      logger.warn({ err: embErr }, 'Failed to embed correction memory');
    }

    if (embedding.length > 0) {
      const existing = getMemoriesWithEmbeddings(chatId);
      for (const mem of existing) {
        const sim = cosineSimilarity(embedding, mem.embedding);
        if (sim > 0.85) {
          logger.debug(
            { similarity: sim.toFixed(3), existingId: mem.id, newSummary: result.summary.slice(0, 60) },
            'Skipping duplicate correction memory',
          );
          return false;
        }
      }
    }

    const memoryId = saveStructuredMemory(
      chatId,
      userMessage,
      result.summary,
      [],
      result.topics ?? [],
      1.0,                  // importance
      'correction',         // source
      agentId,
      1,                    // pinned
    );

    if (embedding.length > 0) {
      saveMemoryEmbedding(memoryId, embedding);
    }

    if (onHighImportanceMemory) {
      try { onHighImportanceMemory(memoryId, result.summary, 1.0); } catch { /* non-fatal */ }
    }

    logger.info(
      { chatId, memoryId, disputedClaim: result.disputed_claim?.slice(0, 80), summary: result.summary.slice(0, 80) },
      'Correction memory pinned',
    );
    return true;
  } catch (err) {
    logger.error({ err }, 'Correction extraction failed (Gemini)');
    return false;
  }
}
