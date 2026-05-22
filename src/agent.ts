import fs from 'fs';
import path from 'path';

import { AGENT_MAX_TURNS, PROJECT_ROOT, agentCwd } from './config.js';
import { readEnvFile } from './env.js';
import { classifyError, AgentError } from './errors.js';
import { logger } from './logger.js';
import { getScrubbedSdkEnv } from './security.js';
import { requireEnabled } from './kill-switches.js';
import { EngineFactory } from './agent-engine/index.js';
import {
  ProviderConfig,
  ProviderRuntimeMode,
  ProviderThinkingMode,
  decodeProviderSession,
  effectiveSkipPermissions,
  encodeProviderSession,
  sessionBelongsToProvider,
} from './provider.js';
import { defaultModelForProvider, getSelectedProviderConfig } from './active-provider.js';

// ── MCP server loading ──────────────────────────────────────────────
// The Agent SDK's settingSources loads CLAUDE.md and permissions from
// project/user settings, but does NOT load mcpServers from those files.
// We read them ourselves and pass them via the `mcpServers` option.

export interface McpStdioConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Merge MCP server configs from user settings (~/.claude/settings.json) and
 * project settings (.claude/settings.json in cwd), optionally filtered by
 * an allowlist (e.g. from an agent's agent.yaml `mcp_servers` field).
 *
 * Exported so the voice bridge can reuse the exact same loader the text
 * bot uses — keeping behavior consistent across channels.
 */
export function loadMcpServers(allowlist?: string[], projectCwd?: string): Record<string, McpStdioConfig> {
  const merged: Record<string, McpStdioConfig> = {};

  // Load from project settings (.claude/settings.json in cwd). `projectCwd`
  // lets callers (e.g. the voice bridge) target a specific sub-agent's
  // settings file without needing the module-level `agentCwd` to be set.
  const projectSettings = path.join(projectCwd ?? agentCwd ?? PROJECT_ROOT, '.claude', 'settings.json');
  // Load from user settings (~/.claude/settings.json)
  const userSettings = path.join(
    process.env.HOME ?? '/tmp',
    '.claude',
    'settings.json',
  );

  for (const file of [userSettings, projectSettings]) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const servers = raw?.mcpServers;
      if (servers && typeof servers === 'object') {
        for (const [name, config] of Object.entries(servers)) {
          const cfg = config as Record<string, unknown>;
          if (cfg.command && typeof cfg.command === 'string') {
            merged[name] = {
              command: cfg.command,
              ...(cfg.args ? { args: cfg.args as string[] } : {}),
              ...(cfg.env ? { env: cfg.env as Record<string, string> } : {}),
            };
          }
        }
      }
    } catch {
      // File doesn't exist or is invalid — skip
    }
  }

  // If an allowlist is provided, only keep the MCPs in that list
  if (allowlist) {
    const allowed = new Set(allowlist);
    for (const name of Object.keys(merged)) {
      if (!allowed.has(name)) delete merged[name];
    }
  }

  return merged;
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  totalCostUsd: number;
  /** True if the SDK auto-compacted context during this turn */
  didCompact: boolean;
  /** Token count before compaction (if it happened) */
  preCompactTokens: number | null;
  /**
   * The cache_read_input_tokens from the LAST API call in the turn.
   * Unlike the cumulative cacheReadInputTokens, this reflects the actual
   * context window size (cumulative overcounts on multi-step tool-use turns).
   */
  lastCallCacheRead: number;
  /**
   * The input_tokens from the LAST API call in the turn.
   * This is the actual context window size: system prompt + conversation
   * history + tool results for that call. Use this for context warnings.
   */
  lastCallInputTokens: number;
}

/**
 * One tool invocation captured from the SDK event stream during a runAgent
 * call. Used by the recommendation gate to determine whether a state-change
 * proposal in the assistant's response is grounded in tool evidence.
 *
 * Shape verified against real SDK output in
 * docs/superpowers/specs/2026-04-28-claudeclaw-control-improvements-verification.md
 */
export interface ToolEvent {
  toolUseId: string;
  name: string;            // e.g. "mcp__mcp-torrent-search__search_torrents"
  isError: boolean;        // true if is_error === true; false otherwise
  hasResult: boolean;      // false if tool_use seen but tool_result not seen
  resultPreview: string;   // first ~200 chars of result content
}

/** Progress event emitted during agent execution for Telegram feedback. */
export interface AgentProgressEvent {
  type: 'task_started' | 'task_completed' | 'tool_active' | 'plan';
  description: string;
  status?: string;
  kind?: string;
  toolCallId?: string;
  locations?: Array<{ path: string; line?: number | null }>;
  planEntries?: Array<{ content: string; status: string; priority?: string }>;
}

function stringifyToolResultPreview(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    const first = raw[0] as { text?: string } | undefined;
    if (first && typeof first.text === 'string') return first.text;
  }
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}

export interface AgentResult {
  text: string | null;
  newSessionId: string | undefined;
  usage: UsageInfo | null;
  aborted?: boolean;
  toolEvents: ToolEvent[];
}

function effortForMode(mode: ProviderRuntimeMode | undefined): 'low' | 'medium' | 'high' | 'max' | undefined {
  const normalized = mode?.toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'fast' || normalized === 'low') return 'low';
  if (normalized === 'normal' || normalized === 'medium' || normalized === 'balanced') return 'medium';
  if (normalized === 'deep' || normalized === 'high') return 'high';
  if (normalized === 'max' || normalized === 'extra_high' || normalized === 'xhigh') return 'max';
  return undefined;
}

function thinkingForMode(
  mode: ProviderThinkingMode | undefined,
): { type: 'adaptive' } | { type: 'enabled'; budgetTokens?: number } | { type: 'disabled' } | undefined {
  const normalized = mode?.toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'off' || normalized === 'disabled') return { type: 'disabled' };
  if (normalized === 'on' || normalized === 'enabled') return { type: 'enabled', budgetTokens: 16000 };
  if (normalized === 'auto' || normalized === 'adaptive' || normalized === 'default') return { type: 'adaptive' };
  return undefined;
}

/**
 * Run a single user message through Claude Code and return the result.
 *
 * Uses `resume` to continue the same session across Telegram messages,
 * giving Claude persistent context without re-sending history.
 *
 * Auth: The SDK spawns the `claude` CLI subprocess which reads OAuth auth
 * from ~/.claude/ automatically (the same auth used in the terminal).
 * No explicit token needed if you're already logged in via `claude login`.
 * Optionally override with CLAUDE_CODE_OAUTH_TOKEN in .env.
 *
 * @param message    The user's text (may include transcribed voice prefix)
 * @param sessionId  Claude Code session ID to resume, or undefined for new session
 * @param onTyping   Called every TYPING_REFRESH_MS while waiting — sends typing action to Telegram
 * @param onProgress Called when sub-agents start/complete — sends status updates to Telegram
 */
/**
 * Per-turn tool restriction passed by chat call sites. Mission tasks and
 * scheduled jobs should leave this undefined so they keep full tool access.
 */
export interface AgentToolPolicy {
  allowedTools?: string[];
  disallowedTools?: string[];
}

export async function runAgent(
  message: string,
  sessionId: string | undefined,
  onTyping: () => void,
  onProgress?: (event: AgentProgressEvent) => void,
  model?: string,
  abortController?: AbortController,
  onStreamText?: (accumulatedText: string) => void,
  mcpAllowlist?: string[],
  providerConfig?: ProviderConfig,
  toolPolicy?: AgentToolPolicy,
): Promise<AgentResult> {
  // Centralized kill-switch enforcement. Throws KillSwitchDisabledError if
  // LLM_SPAWN_ENABLED has been flipped off — caller is expected to surface
  // a "feature disabled" message rather than retry. This is the SINGLE
  // chokepoint for Telegram, scheduler, mission worker, and any other
  // path that ends up here; the war-room and voice paths have their own
  // requireEnabled calls at their own SDK boundaries.
  requireEnabled('LLM_SPAWN_ENABLED');

  const provider = providerConfig ?? getSelectedProviderConfig();
  const providerSessionId = sessionBelongsToProvider(sessionId, provider)
    ? decodeProviderSession(provider, sessionId)
    : undefined;

  const effectiveModel = model ?? defaultModelForProvider(provider);
  const effectiveEffort = effortForMode(provider.runtimeMode);
  const effectiveThinking = thinkingForMode(provider.thinkingMode);
  // Read secrets from .env without polluting process.env.
  // CLAUDE_CODE_OAUTH_TOKEN is optional — the subprocess finds auth via ~/.claude/
  // automatically. Only needed if you want to override which account is used.
  const secrets = readEnvFile(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']);
  // Strip secret-shaped env vars (DASHBOARD_TOKEN, third-party API keys,
  // DB_ENCRYPTION_KEY, etc.) before handing process.env to the SDK
  // subprocess. A prompt-injected agent that calls `env` or `cat .env`
  // can otherwise read every credential the parent process holds.
  const sdkEnv = getScrubbedSdkEnv(secrets);

  let newSessionId: string | undefined;
  let resultText: string | null = null;
  let usage: UsageInfo | null = null;
  let didCompact = false;
  let preCompactTokens: number | null = null;
  let lastCallCacheRead = 0;
  let lastCallInputTokens = 0;
  const toolEvents: ToolEvent[] = [];
  const toolUseById = new Map<string, ToolEvent>();

  // Refresh typing indicator on an interval while Claude works.
  // Telegram's "typing..." action expires after ~5s.
  const typingInterval = setInterval(onTyping, 4000);

  try {
    // Load MCP servers from project + user settings files, filtered by agent allowlist
    const mcpServers = loadMcpServers(mcpAllowlist);
    const mcpServerNames = Object.keys(mcpServers);
    logger.info(
      { sessionId: providerSessionId ?? 'new', messageLen: message.length, mcpServers: mcpServerNames },
      'Starting agent query',
    );

    const engine = EngineFactory.forProvider(provider);
    for await (const event of engine.invoke({
      prompt: message,
      provider,
      sessionId: providerSessionId,
      cwd: agentCwd ?? PROJECT_ROOT,
      settingSources: ['project', 'user'],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: effectiveSkipPermissions(provider),
      ...(AGENT_MAX_TURNS > 0 ? { maxTurns: AGENT_MAX_TURNS } : {}),
      env: sdkEnv,
      ...(mcpServerNames.length > 0 ? { mcpServers } : {}),
      includePartialMessages: !!onStreamText,
      ...(effectiveModel ? { model: effectiveModel } : {}),
      ...(provider.runtimeMode ? { runtimeMode: provider.runtimeMode } : {}),
      ...(provider.thinkingMode ? { thinkingMode: provider.thinkingMode } : {}),
      ...(effectiveEffort ? { effort: effectiveEffort } : {}),
      ...(effectiveThinking ? { thinking: effectiveThinking } : {}),
      ...(toolPolicy?.allowedTools ? { allowedTools: toolPolicy.allowedTools } : {}),
      ...(toolPolicy?.disallowedTools ? { disallowedTools: toolPolicy.disallowedTools } : {}),
      abortController,
    })) {
      if (event.type === 'session') {
        newSessionId = event.sessionId;
        logger.info({ newSessionId }, 'Session initialized');
      }

      if (event.type === 'compact') {
        didCompact = true;
        preCompactTokens = event.preCompactTokens;
        logger.warn(
          { trigger: event.trigger, preCompactTokens },
          'Context window compacted',
        );
      }

      if (event.type === 'progress') {
        onProgress?.(event.progress);

        // Capture tool_use / tool_result blocks into the toolEvents buffer
        // for the recommendation gate. Upstream's provider engine forwards
        // tool activity as 'progress' events; the original SDK event is on
        // `event.raw` (Claude SDK provider only — ACP does not populate it).
        const raw = event.raw as Record<string, unknown> | undefined;
        if (raw?.['type'] === 'assistant') {
          const msg = raw['message'] as Record<string, unknown> | undefined;
          const content = msg?.['content'] as
            | Array<{ type: string; id?: string; name?: string }>
            | undefined;
          if (Array.isArray(content)) {
            for (const block of content) {
              // The adapter emits one 'progress' event per tool_use block, but
              // each carries the whole assistant message on `raw`. Dedup by id
              // so a multi-tool message is not counted once per block.
              if (
                block.type === 'tool_use' &&
                block.id &&
                block.name &&
                !toolUseById.has(block.id)
              ) {
                const te: ToolEvent = {
                  toolUseId: block.id,
                  name: block.name,
                  isError: false,
                  hasResult: false,
                  resultPreview: '',
                };
                toolEvents.push(te);
                toolUseById.set(block.id, te);
              }
            }
          }
        }
        if (raw?.['type'] === 'user') {
          const msg = raw['message'] as Record<string, unknown> | undefined;
          const content = msg?.['content'] as
            | Array<{
                type: string;
                tool_use_id?: string;
                is_error?: boolean | null;
                content?: unknown;
              }>
            | undefined;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'tool_result' && block.tool_use_id) {
                const found = toolUseById.get(block.tool_use_id);
                if (found) {
                  found.isError = block.is_error === true;
                  found.hasResult = true;
                  found.resultPreview = stringifyToolResultPreview(block.content).slice(0, 200);
                }
              }
            }
          }
        }
      }

      if (event.type === 'text_delta') {
        onStreamText?.(event.accumulatedText);
      }

      if (event.type === 'usage') {
        usage = event.usage;
        lastCallCacheRead = usage.lastCallCacheRead;
        lastCallInputTokens = usage.lastCallInputTokens;
      }

      if (event.type === 'aborted') {
        return {
          text: event.text,
          newSessionId: encodeProviderSession(provider, event.sessionId ?? newSessionId ?? providerSessionId),
          usage: event.usage,
          aborted: true,
          toolEvents,
        };
      }

      if (event.type === 'result') {
        resultText = event.text;
        if (event.usage) {
          usage = event.usage;
          logger.info(
            {
              inputTokens: usage.inputTokens,
              cacheReadTokens: usage.cacheReadInputTokens,
              lastCallCacheRead: usage.lastCallCacheRead,
              lastCallInputTokens: usage.lastCallInputTokens,
              costUsd: usage.totalCostUsd,
              didCompact,
            },
            'Turn usage',
          );
        }

        logger.info(
          { hasResult: !!resultText, subtype: event.stopReason },
          'Agent result received',
        );
      }
    }
  } catch (err) {
    if (abortController?.signal.aborted) {
      logger.info('Agent query aborted by user');
      return { text: null, newSessionId, usage, aborted: true, toolEvents };
    }

    // Classify the error and attach context-aware metadata
    const contextTokens = lastCallInputTokens || lastCallCacheRead || 0;
    const classified = classifyError(err, contextTokens || undefined);
    logger.error(
      { category: classified.category, recovery: classified.recovery, originalMsg: (err as Error)?.message },
      'Agent query failed (classified)',
    );
    throw classified;
  } finally {
    clearInterval(typingInterval);
  }

  return { text: resultText, newSessionId: encodeProviderSession(provider, newSessionId), usage, toolEvents };
}

// ── Retry wrapper ─────────────────────────────────────────────────

const MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 2000;
const BACKOFF_MULTIPLIER = 4; // 2s, 8s

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run the agent with automatic retry for transient errors.
 * Only retries errors where recovery.shouldRetry is true.
 * Calls onRetry before each retry so the caller can notify the user.
 */
export async function runAgentWithRetry(
  message: string,
  sessionId: string | undefined,
  onTyping: () => void,
  onProgress?: (event: AgentProgressEvent) => void,
  model?: string,
  abortController?: AbortController,
  onStreamText?: (accumulatedText: string) => void,
  onRetry?: (attempt: number, error: AgentError) => void,
  fallbackModels?: string[],
  mcpAllowlist?: string[],
  providerConfig?: ProviderConfig,
  toolPolicy?: AgentToolPolicy,
): Promise<AgentResult> {
  let lastError: AgentError | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const currentModel =
        attempt === 0 ? model
        : lastError?.recovery.shouldSwitchModel && fallbackModels?.length
          ? fallbackModels[Math.min(attempt - 1, fallbackModels.length - 1)]
          : model;

      return await runAgent(
        message, sessionId, onTyping, onProgress,
        currentModel, abortController, onStreamText,
        mcpAllowlist,
        providerConfig,
        toolPolicy,
      );
    } catch (err) {
      if (!(err instanceof AgentError)) throw err;
      lastError = err;

      // Don't retry non-retryable errors or if aborted
      if (!err.recovery.shouldRetry || abortController?.signal.aborted) {
        throw err;
      }

      // Don't retry past the limit
      if (attempt >= MAX_RETRIES) {
        throw err;
      }

      const delayMs = Math.min(
        BACKOFF_BASE_MS * Math.pow(BACKOFF_MULTIPLIER, attempt),
        60000,
      );
      // Add jitter (0-25% of delay)
      const jitter = Math.random() * delayMs * 0.25;

      logger.warn(
        { attempt: attempt + 1, category: err.category, delayMs: Math.round(delayMs + jitter) },
        'Retrying agent query',
      );

      onRetry?.(attempt + 1, err);
      await sleep(delayMs + jitter);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError ?? new Error('Retry loop exhausted');
}
