import { z } from "zod";

export type OrbitRole = "system" | "user" | "assistant" | "tool";

export type ModelApiFormat = "chat-completions" | "responses" | "anthropic";
export type ProviderApiFormat = "auto" | ModelApiFormat;
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";
export type ToolChoice =
  | "none"
  | "auto"
  | "required"
  | { type: "tool"; name: string };

/** Functional model family used to prevent incompatible API routing. */
export type ModelKind =
  | "chat"
  | "embedding"
  | "image"
  | "video"
  | "audio"
  | "search"
  | "rerank"
  | "unknown";

export interface OrbitToolCall {
  id: string;
  name: string;
  arguments: string; // JSON string
}

export interface OrbitToolResult {
  toolCallId: string;
  name: string;
  content: string;
  isError?: boolean;
}

export interface OrbitMessage {
  id: string;
  role: OrbitRole;
  content: OrbitContentBlock[];
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export type OrbitContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
      data: string;
      name?: string;
    }
  | { type: "tool_call"; toolCall: OrbitToolCall }
  | { type: "tool_result"; toolResult: OrbitToolResult }
  | { type: "thinking"; text: string; signature?: string };

export interface ModelCapabilities {
  streaming: boolean;
  toolCalls: boolean;
  jsonMode: boolean;
  thinking: boolean;
  vision: boolean;
  promptCaching: boolean;
  maxContextTokens?: number;
  maxOutputTokens?: number;
  kind?: ModelKind;
  inputModalities?: string[];
  outputModalities?: string[];
  apiFormats?: ModelApiFormat[];
  reasoningEfforts?: ReasoningEffort[];
  parallelToolCalls?: boolean;
  modelVersion?: string;
  effectiveContextWindowPercent?: number;
}

export interface ProviderRuntimeOptions {
  id?: string;
  apiKeyEnv?: string;
  apiKeyHeader?: string;
  apiKeyPrefix?: string;
  headers?: Record<string, string>;
  requestTimeoutMs?: number;
  streamTimeoutMs?: number;
  totalTimeoutMs?: number;
  maxRetries?: number;
  disablePreheat?: boolean;
  deepSeekApiFormat?: ProviderApiFormat;
  /** Internal protocol policy; not read directly from untrusted config. */
  anthropicDialect?: "deepseek";
  /** Resolve credentials at request time so rotations do not require restart. */
  apiKeyResolver?: () => string | undefined;
  extraBody?: Record<string, unknown>;
  capabilities?: Partial<ModelCapabilities>;
  modelCapabilities?: Record<string, Partial<ModelCapabilities>>;
}

export interface OrbitToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  inputJsonSchema?: Record<string, unknown>;
}

export interface ModelChatInput {
  model: string;
  messages: OrbitMessage[];
  system?: string;
  tools?: OrbitToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  thinking?: {
    enabled: boolean;
    budgetTokens?: number;
    effort?: ReasoningEffort;
  };
  responseFormat?: "text" | "json";
  responseJsonSchema?: Record<string, unknown>;
  toolChoice?: ToolChoice;
  stopSequences?: string[];
  abortSignal?: AbortSignal;
  userId?: string;
  /** Optional caller-owned retry budget. Providers retain their defaults when omitted. */
  retryBudget?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheMissTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

export type ModelEvent =
  | {
      type: "response_metadata";
      requestedModel: string;
      resolvedModel?: string;
      providerRequestId?: string;
      apiFormat?: ModelApiFormat;
      modelVersion?: string;
      reasoningEffort?: ReasoningEffort | "none";
      endpointKind?: "official" | "gateway";
      attempt?: number;
      apiFormatFallback?: { from: ModelApiFormat; status: number };
    }
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string; signature?: string }
  | { type: "tool_call"; toolCall: OrbitToolCall }
  | { type: "usage"; usage: TokenUsage }
  | { type: "done" }
  | { type: "error"; error: unknown };

export interface ModelProvider {
  id: string;
  type:
    | "openai"
    | "anthropic"
    | "openai-compatible"
    | "anthropic-compatible"
    | "deepseek"
    | "ollama";
  capabilities: ModelCapabilities;
  initialize?(): Promise<void>;
  chat(input: ModelChatInput): AsyncIterable<ModelEvent>;
  countTokens?(input: ModelChatInput): Promise<number>;
  embed?(texts: string[], options?: { model?: string }): Promise<number[][]>;
  complete?(
    prompt: string,
    options?: {
      model?: string;
      maxTokens?: number;
      stop?: string[];
      suffix?: string;
      abortSignal?: AbortSignal;
    },
  ): Promise<string>;
  getModelCapabilities?(model: string): ModelCapabilities;
}
