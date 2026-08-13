import type { OrbitConfig } from "@orbit-build/config";
import type { ModelProvider, OrbitMessage } from "@orbit-build/model-providers";
import {
  isProviderError,
  resolveModelCapabilities,
} from "@orbit-build/model-providers";
import {
  estimateTokenCount,
  truncateTextToTokenBudget,
} from "@orbit-build/shared";
import { VOLATILE_CONTEXT_MESSAGE_KIND } from "./MessageBuilder.js";

const DEFAULT_MODEL_CONTEXT_TOKENS = 128_000;

export interface ContextWindowStatus {
  model: string;
  advertisedContextTokens: number;
  maxContextTokens: number;
  reservedOutputTokens: number;
  compactAtTokens: number;
  estimatedHistoryTokens: number;
  utilization: number;
  capabilitySource: "provider" | "safe-default";
}

export interface HistoryCompactionStats {
  mode: "manual" | "automatic";
  beforeTokens: number;
  afterTokens: number;
  truncatedToolResults: number;
  truncatedContextMessages: number;
  droppedMessages: number;
  changed: boolean;
}

export interface CompactedHistory extends HistoryCompactionStats {
  history: OrbitMessage[];
  /** Messages removed by Phase 2, available for semantic summarization. */
  droppedHistory?: OrbitMessage[];
  /** Id of the inserted summary message so callers can refine its text. */
  summaryMessageId?: string;
}

export interface ContextWindowInput {
  model: string;
  config: OrbitConfig;
  provider: ModelProvider;
  history: OrbitMessage[];
}

/** Resolves the safe input and output budgets for one concrete model. */
export function resolveContextWindowStatus(
  input: ContextWindowInput,
): ContextWindowStatus {
  const { model, config, provider, history } = input;
  const modelCapabilities = resolveModelCapabilities(provider, model);

  const advertisedContextTokens = Math.max(
    1,
    Math.floor(
      modelCapabilities.maxContextTokens || DEFAULT_MODEL_CONTEXT_TOKENS,
    ),
  );
  const effectiveContextPercent = Math.max(
    0.5,
    Math.min(1, modelCapabilities.effectiveContextWindowPercent ?? 1),
  );
  const maxContextTokens = Math.max(
    1,
    Math.floor(advertisedContextTokens * effectiveContextPercent),
  );
  const configuredMaxOutputTokens =
    model === config.models.fast
      ? (config.agent?.fastMaxOutputTokens ?? 32768)
      : (config.agent?.maxOutputTokens ?? 16_384);
  const modelMaxOutputTokens =
    modelCapabilities.maxOutputTokens || configuredMaxOutputTokens;
  const maxOutputByContext = Math.max(1, Math.floor(maxContextTokens * 0.25));
  const reservedOutputTokens = Math.max(
    1,
    Math.min(
      configuredMaxOutputTokens,
      modelMaxOutputTokens,
      maxOutputByContext,
      Math.max(1, maxContextTokens - 1),
    ),
  );
  const threshold = Math.max(
    0.5,
    Math.min(0.9, config.context.compactThreshold),
  );
  const compactAtTokens = Math.max(
    1,
    Math.min(
      maxContextTokens - reservedOutputTokens,
      Math.floor(maxContextTokens * threshold),
    ),
  );
  const estimatedHistoryTokens = estimateTokenCount(JSON.stringify(history));

  return {
    model,
    advertisedContextTokens,
    maxContextTokens,
    reservedOutputTokens,
    compactAtTokens,
    estimatedHistoryTokens,
    utilization: estimatedHistoryTokens / maxContextTokens,
    capabilitySource: modelCapabilities.maxContextTokens
      ? "provider"
      : "safe-default",
  };
}

/** Detects provider errors that can be recovered by shrinking the prompt. */
export function isContextWindowError(error: unknown): boolean {
  if (isProviderError(error)) {
    return error.code === "CONTEXT_WINDOW_EXCEEDED";
  }
  const message = error instanceof Error ? error.message : String(error);
  if (isOutputTokenLimitError(message)) return false;
  return /(?:maximum context length|context(?: length| window)?.*(?:exceed|too long|maximum|max)|prompt is too long|input tokens?.*(?:exceed|limit))/i.test(
    message,
  );
}

/** Detects a completed request whose response exceeded the output allowance. */
export function isOutputTokenLimitError(error: unknown): boolean {
  if (isProviderError(error)) return error.code === "OUTPUT_LIMIT";
  const message = error instanceof Error ? error.message : String(error);
  return /(?:model output.*(?:truncated|token limit)|output tokens?.*(?:exceed|limit)|finish(?:_reason)?.*(?:length|max_tokens)|configured output token limit)/i.test(
    message,
  );
}

/** Compacts a history copy without mutating the caller's live state. */
export function compactHistoryMessages(
  sourceHistory: OrbitMessage[],
  options: {
    mode: "manual" | "automatic";
    compactAtTokens: number;
    targetHistoryTokens?: number;
  },
): CompactedHistory {
  const { mode } = options;
  let history = structuredClone(sourceHistory);
  const beforeTokens = estimateTokenCount(JSON.stringify(history));
  const protectedTailSize = Math.min(
    mode === "manual" ? 8 : 16,
    Math.max(4, Math.floor(history.length / 3)),
  );
  const compactBoundary = Math.max(0, history.length - protectedTailSize);
  const maxToolResultLength = 300;
  let truncatedToolResults = 0;

  for (let index = 0; index < compactBoundary; index++) {
    const message = history[index];
    for (const block of message.content) {
      if (
        block.type === "tool_result" &&
        block.toolResult.content.length > maxToolResultLength
      ) {
        block.toolResult.content = `${block.toolResult.content.slice(0, maxToolResultLength)}\n... [truncated]`;
        truncatedToolResults++;
      } else if (
        block.type === "text" &&
        message.role === "tool" &&
        block.text.length > maxToolResultLength
      ) {
        block.text = `${block.text.slice(0, maxToolResultLength)}\n... [truncated]`;
        truncatedToolResults++;
      }
    }
  }

  const targetTokens = Math.max(
    256,
    Math.floor(
      options.targetHistoryTokens ??
        (mode === "manual"
          ? beforeTokens * 0.6
          : options.compactAtTokens * 0.7),
    ),
  );
  const tokensAfterTruncation = estimateTokenCount(JSON.stringify(history));
  const shouldSummarize =
    history.length > 4 &&
    (mode === "manual"
      ? tokensAfterTruncation >= 1024
      : tokensAfterTruncation > targetTokens);
  let droppedMessages = 0;
  let droppedHistory: OrbitMessage[] | undefined;
  let summaryMessageId: string | undefined;

  if (shouldSummarize) {
    const minimumRecentMessages = mode === "manual" ? 4 : 2;
    const recentTokenBudget = Math.max(256, Math.floor(targetTokens * 0.8));
    let keptTokens = 0;
    let keptMessages = 0;
    let cutIndex = history.length;

    while (cutIndex > 0) {
      const nextTokens = estimateTokenCount(
        JSON.stringify(history[cutIndex - 1]),
      );
      if (
        keptMessages >= minimumRecentMessages &&
        keptTokens + nextTokens > recentTokenBudget
      ) {
        break;
      }
      cutIndex--;
      keptMessages++;
      keptTokens += nextTokens;
    }

    if (mode === "manual" && cutIndex === 0 && history.length > 4) {
      cutIndex = Math.floor(history.length / 2);
    }
    cutIndex = moveCutBeforeToolExchange(history, cutIndex);

    if (cutIndex > 0) {
      droppedMessages = cutIndex;
      droppedHistory = history.slice(0, cutIndex);
      const summaryMessage: OrbitMessage = {
        id: `msg_compaction_summary_${Date.now()}`,
        role: "user",
        createdAt: new Date().toISOString(),
        content: [
          {
            type: "text",
            text: buildCompactionSummary(droppedHistory),
          },
        ],
        metadata: { kind: "history_compaction_summary" },
      };
      summaryMessageId = summaryMessage.id;
      history = [summaryMessage, ...history.slice(cutIndex)];
    }
  }

  const contextResult =
    mode === "automatic"
      ? truncateVolatileContextToBudget(history, targetTokens)
      : { history, truncated: 0 };
  history = contextResult.history;
  const afterTokens = estimateTokenCount(JSON.stringify(history));
  const changed =
    truncatedToolResults > 0 ||
    contextResult.truncated > 0 ||
    droppedMessages > 0;

  if (mode === "manual" && changed && afterTokens >= beforeTokens) {
    return {
      history: sourceHistory,
      mode,
      beforeTokens,
      afterTokens: beforeTokens,
      truncatedToolResults: 0,
      truncatedContextMessages: 0,
      droppedMessages: 0,
      changed: false,
    };
  }

  return {
    history,
    ...(droppedHistory ? { droppedHistory, summaryMessageId } : {}),
    mode,
    beforeTokens,
    afterTokens,
    truncatedToolResults,
    truncatedContextMessages: contextResult.truncated,
    droppedMessages,
    changed,
  };
}

const SEMANTIC_SUMMARY_MIN_DIGEST_CHARS = 400;
const SEMANTIC_SUMMARY_DIGEST_TOKEN_BUDGET = 6_000;

/**
 * Replace the mechanical snippet summary with a fast-model semantic summary
 * of the dropped turns. Returns null on any failure so the caller keeps the
 * mechanical summary — compaction must never depend on a model call.
 */
export async function buildSemanticCompactionSummary(
  dropped: OrbitMessage[],
  provider: ModelProvider,
  fastModel: string,
): Promise<string | null> {
  if (!fastModel || dropped.length === 0) return null;
  const digest = buildDroppedHistoryDigest(dropped);
  if (digest.length < SEMANTIC_SUMMARY_MIN_DIGEST_CHARS) return null;

  const prompt = [
    "Summarize this compacted conversation history for a coding agent that must continue the task.",
    "Preserve, densely and factually:",
    "1. The user's objectives and constraints.",
    "2. Decisions made and approaches chosen or rejected.",
    "3. Files created or modified, with exact paths.",
    "4. Key findings, errors, and their resolutions.",
    "5. Current task state and unfinished steps.",
    "Output plain text under 400 words. No preamble.",
    "",
    "--- HISTORY START ---",
    digest,
    "--- HISTORY END ---",
  ].join("\n");

  try {
    let text = "";
    for await (const event of provider.chat({
      model: fastModel,
      messages: [
        {
          id: `msg_compaction_semantic_${Date.now()}`,
          role: "user",
          createdAt: new Date().toISOString(),
          content: [{ type: "text", text: prompt }],
        },
      ],
      tools: [],
      thinking: { enabled: false },
      maxTokens: 1024,
    })) {
      if (event.type === "text_delta") text += event.text;
      if (event.type === "error") return null;
    }
    const cleaned = text.trim();
    if (!cleaned) return null;
    const body = cleaned.startsWith("[Conversation Summary]")
      ? cleaned
      : `[Conversation Summary]\n${cleaned}`;
    return `${body}\nRely on recent turns for exact current instructions.`;
  } catch {
    return null;
  }
}

function buildDroppedHistoryDigest(dropped: OrbitMessage[]): string {
  const lines: string[] = [];
  for (const message of dropped) {
    const text = message.content
      .map((block) => {
        if (block.type === "text") return block.text;
        if (block.type === "tool_call")
          return `[tool_call ${block.toolCall.name} ${block.toolCall.arguments.slice(0, 200)}]`;
        if (block.type === "tool_result") {
          return `[tool_result ${block.toolResult.name} ${block.toolResult.isError ? "error" : "ok"}: ${block.toolResult.content.slice(0, 300)}]`;
        }
        return "";
      })
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) lines.push(`${message.role}: ${text.slice(0, 600)}`);
  }
  return truncateTextToTokenBudget(
    lines.join("\n"),
    SEMANTIC_SUMMARY_DIGEST_TOKEN_BUDGET,
    "\n... [older turns omitted from digest] ...\n",
  );
}

/** Produces the stable summary inserted before the retained recent tail. */
export function buildCompactionSummary(messages: OrbitMessage[]): string {
  const lines = [
    "[Conversation Summary]",
    "Older conversation turns were compacted to preserve context budget. Use this stable summary as background; rely on recent turns for exact current instructions.",
  ];
  const snippets: string[] = [];

  for (const message of messages.slice(-24)) {
    const text = message.content
      .map((block) => {
        if (block.type === "text") return block.text;
        if (block.type === "tool_call")
          return `tool_call:${block.toolCall.name}`;
        if (block.type === "tool_result") {
          return `tool_result:${block.toolResult.name}:${block.toolResult.isError ? "error" : "ok"}`;
        }
        return "";
      })
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) snippets.push(`- ${message.role}: ${text.slice(0, 240)}`);
  }

  lines.push(
    ...(snippets.length > 0
      ? snippets.slice(-12)
      : ["- No compactable text content was found."]),
  );
  return lines.join("\n");
}

function moveCutBeforeToolExchange(
  history: OrbitMessage[],
  initialCutIndex: number,
): number {
  let cutIndex = initialCutIndex;
  while (cutIndex > 0) {
    const message = history[cutIndex];
    if (message.role === "tool") {
      cutIndex--;
      continue;
    }
    const previous = history[cutIndex - 1];
    if (
      previous.role === "assistant" &&
      previous.content.some((content) => content.type === "tool_call")
    ) {
      cutIndex--;
      continue;
    }
    break;
  }
  return cutIndex;
}

function truncateVolatileContextToBudget(
  sourceHistory: OrbitMessage[],
  targetTokens: number,
): { history: OrbitMessage[]; truncated: number } {
  const history = sourceHistory;
  let currentTokens = estimateTokenCount(JSON.stringify(history));
  if (currentTokens <= targetTokens) return { history, truncated: 0 };

  const candidates = history
    .flatMap((message) =>
      message.metadata?.kind === VOLATILE_CONTEXT_MESSAGE_KIND
        ? message.content
            .filter(
              (block): block is { type: "text"; text: string } =>
                block.type === "text",
            )
            .map((block) => ({ block, tokens: estimateTokenCount(block.text) }))
        : [],
    )
    .sort((left, right) => right.tokens - left.tokens);
  let truncated = 0;

  for (const candidate of candidates) {
    if (currentTokens <= targetTokens) break;
    const excess = currentTokens - targetTokens;
    const desiredTokens = Math.max(256, candidate.tokens - excess - 64);
    const nextText = truncateTextToTokenBudget(
      candidate.block.text,
      desiredTokens,
      "\n\n... [volatile context compacted to fit model window] ...\n\n",
    );
    if (nextText === candidate.block.text) continue;
    candidate.block.text = nextText;
    truncated++;
    currentTokens = estimateTokenCount(JSON.stringify(history));
  }
  return { history, truncated };
}
