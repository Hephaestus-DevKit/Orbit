import { z } from "zod";
import { readResponseTextWithinLimit } from "@orbit-build/shared";

const ModelEntrySchema = z
  .object({
    id: z.unknown().optional(),
    model: z.unknown().optional(),
    context_length: z.unknown().optional(),
    context_window: z.unknown().optional(),
    max_context_tokens: z.unknown().optional(),
    max_output_tokens: z.unknown().optional(),
    input_modalities: z.unknown().optional(),
    output_modalities: z.unknown().optional(),
    modalities: z.unknown().optional(),
    architecture: z.unknown().optional(),
    capabilities: z.unknown().optional(),
    supported_parameters: z.unknown().optional(),
    type: z.unknown().optional(),
    kind: z.unknown().optional(),
    task: z.unknown().optional(),
    endpoint: z.unknown().optional(),
    details: z.unknown().optional(),
  })
  .passthrough();

const ModelListSchema = z.union([
  z.object({ data: z.array(ModelEntrySchema).max(1000) }),
  z.object({ models: z.array(ModelEntrySchema).max(1000) }),
  z.array(ModelEntrySchema).max(1000),
]);

const DiscoveryUrlSchema = z
  .string()
  .url()
  .max(4096)
  .transform((value) => new URL(value));

export interface DiscoveredProviderModels {
  baseUrl: string;
  modelsEndpoint: string;
  models: string[];
  modelCapabilities: Record<string, DiscoveredModelCapabilities>;
}

export interface DiscoveredModelCapabilities {
  streaming?: boolean;
  toolCalls?: boolean;
  jsonMode?: boolean;
  thinking?: boolean;
  vision?: boolean;
  promptCaching?: boolean;
  maxContextTokens?: number;
  maxOutputTokens?: number;
  kind?:
    | "chat"
    | "embedding"
    | "image"
    | "video"
    | "audio"
    | "search"
    | "rerank"
    | "unknown";
  inputModalities?: string[];
  outputModalities?: string[];
}

export interface ModelDiscoveryOptions {
  baseUrl: string;
  apiKey?: string;
  providerType?: "ollama";
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const MAX_MODEL_RESPONSE_BYTES = 2 * 1024 * 1024;

/** Probe common OpenAI-compatible model endpoints without leaking credentials. */
export async function discoverProviderModels(
  options: ModelDiscoveryOptions,
): Promise<DiscoveredProviderModels> {
  const base = DiscoveryUrlSchema.parse(options.baseUrl.trim());
  if (
    base.protocol !== "https:" &&
    !(
      base.protocol === "http:" &&
      ["127.0.0.1", "localhost", "::1"].includes(base.hostname)
    )
  ) {
    throw new Error(
      "Provider discovery requires HTTPS, except for local development endpoints.",
    );
  }
  base.username = "";
  base.password = "";
  base.search = "";
  base.hash = "";

  const fetchImpl = options.fetchImpl ?? fetch;
  const normalizedBaseUrl = base.toString().replace(/\/$/, "");
  const endpoint = buildModelEndpoint(base, options.providerType);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1000, Math.min(30_000, options.timeoutMs ?? 8000)),
  );
  try {
    const headers = new Headers({ Accept: "application/json" });
    if (options.apiKey) {
      headers.set("Authorization", `Bearer ${options.apiKey}`);
    }
    const response = await fetchImpl(endpoint, {
      method: "GET",
      headers,
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Model catalog returned HTTP ${response.status}.`);
    }
    const text = await readResponseTextWithinLimit(
      response,
      MAX_MODEL_RESPONSE_BYTES,
      "Model catalog response",
    );
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("Model catalog did not return JSON.");
    }
    const parsed = ModelListSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error("Model catalog returned an unsupported schema.");
    }
    const entries = Array.isArray(parsed.data)
      ? parsed.data
      : "data" in parsed.data
        ? parsed.data.data
        : parsed.data.models;
    const normalized = normalizeModelEntries(entries);
    if (normalized.models.length === 0) {
      throw new Error("Model catalog is empty.");
    }
    if (options.providerType === "ollama") {
      await enrichOllamaCapabilities(
        base,
        normalized.models,
        normalized.modelCapabilities,
        fetchImpl,
        controller.signal,
      );
    }
    return {
      baseUrl: normalizedBaseUrl,
      modelsEndpoint: endpoint.toString(),
      ...normalized,
    };
  } catch (error: unknown) {
    const reason =
      error instanceof Error && error.name === "AbortError"
        ? "request timed out"
        : error instanceof Error
          ? error.message
          : "request failed";
    throw new Error(
      `Unable to read the exact model catalog ${endpoint.pathname}: ${reason}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function buildModelEndpoint(
  base: URL,
  providerType?: ModelDiscoveryOptions["providerType"],
): URL {
  const normalizedPath = base.pathname.replace(/\/+$/, "");
  if (providerType === "ollama") {
    const endpoint = new URL(base);
    endpoint.pathname = `${normalizedPath || ""}/api/tags`;
    return endpoint;
  }
  if (normalizedPath.endsWith("/models")) {
    throw new Error(
      "Enter the API base URL before /models (for example https://host/v1).",
    );
  }
  const endpoint = new URL(base);
  endpoint.pathname = `${normalizedPath || ""}/models`;
  return endpoint;
}

function normalizeModelEntries(entries: z.infer<typeof ModelEntrySchema>[]) {
  const models: string[] = [];
  const seen = new Set<string>();
  const modelCapabilities: Record<string, DiscoveredModelCapabilities> = {};
  for (const entry of entries) {
    const rawId =
      typeof entry.id === "string"
        ? entry.id
        : typeof entry.model === "string"
          ? entry.model
          : "";
    const id = rawId.trim().slice(0, 1024);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push(id);
    const capabilities: DiscoveredModelCapabilities = {};
    const maxContextTokens = [
      entry.context_length,
      entry.context_window,
      entry.max_context_tokens,
      readRecord(entry.details).context_length,
    ].find(isSafeTokenLimit);
    const maxOutputTokens = [entry.max_output_tokens].find(isSafeTokenLimit);
    if (maxContextTokens) capabilities.maxContextTokens = maxContextTokens;
    if (maxOutputTokens) capabilities.maxOutputTokens = maxOutputTokens;

    const declared = readRecord(entry.capabilities);
    copyBooleanCapability(declared, "streaming", capabilities, "streaming");
    copyBooleanCapability(declared, "vision", capabilities, "vision");
    copyBooleanCapability(declared, "thinking", capabilities, "thinking");
    copyBooleanCapability(declared, "reasoning", capabilities, "thinking");
    copyBooleanCapability(declared, "tool_calls", capabilities, "toolCalls");

    const architecture = readRecord(entry.architecture);
    const inputModalities = collectStrings(
      entry.input_modalities,
      architecture.input_modalities,
    );
    const outputModalities = collectStrings(
      entry.output_modalities,
      architecture.output_modalities,
    );
    const genericModalities = collectStrings(
      entry.modalities,
      architecture.modalities,
    );
    for (const modality of genericModalities) inputModalities.add(modality);
    if (inputModalities.size > 0) {
      capabilities.inputModalities = [...inputModalities];
    }
    if (outputModalities.size > 0) {
      capabilities.outputModalities = [...outputModalities];
    }
    if (inputModalities.has("image")) capabilities.vision = true;

    const parameters = collectStrings(entry.supported_parameters);
    if (
      parameters.has("tools") ||
      parameters.has("tool_choice") ||
      parameters.has("function_calling")
    ) {
      capabilities.toolCalls = true;
    }
    if (
      parameters.has("reasoning") ||
      parameters.has("reasoning_effort") ||
      parameters.has("thinking")
    ) {
      capabilities.thinking = true;
    }
    if (parameters.has("response_format") || parameters.has("json_schema")) {
      capabilities.jsonMode = true;
    }
    capabilities.kind = classifyModelKind(
      entry,
      declared,
      inputModalities,
      outputModalities,
      parameters,
    );
    if (Object.keys(capabilities).length > 0) {
      modelCapabilities[id] = capabilities;
    }
  }
  return { models, modelCapabilities };
}

const OllamaShowSchema = z
  .object({
    capabilities: z.array(z.string().max(128)).max(64).optional(),
    model_info: z.record(z.unknown()).optional(),
  })
  .passthrough();

async function enrichOllamaCapabilities(
  base: URL,
  models: string[],
  target: Record<string, DiscoveredModelCapabilities>,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<void> {
  const endpoint = new URL(base);
  endpoint.pathname = `${base.pathname.replace(/\/+$/, "") || ""}/api/show`;
  const batchSize = 4;
  for (let offset = 0; offset < models.length; offset += batchSize) {
    const batch = models.slice(offset, offset + batchSize);
    await Promise.all(
      batch.map(async (model) => {
        try {
          const response = await fetchImpl(endpoint, {
            method: "POST",
            headers: new Headers({
              Accept: "application/json",
              "Content-Type": "application/json",
            }),
            body: JSON.stringify({ model, verbose: false }),
            redirect: "error",
            signal,
          });
          if (!response.ok) {
            await response.body?.cancel().catch(() => undefined);
            return;
          }
          const text = await readResponseTextWithinLimit(
            response,
            MAX_MODEL_RESPONSE_BYTES,
            "Ollama model detail response",
          );
          const parsed = OllamaShowSchema.safeParse(JSON.parse(text));
          if (!parsed.success) return;
          const declared = new Set(
            (parsed.data.capabilities || []).map((value) =>
              value.toLowerCase(),
            ),
          );
          const capabilities = target[model] || {};
          if (declared.has("embedding")) capabilities.kind = "embedding";
          else if (declared.has("completion")) capabilities.kind = "chat";
          if (declared.has("tools")) capabilities.toolCalls = true;
          if (declared.has("thinking")) capabilities.thinking = true;
          if (declared.has("vision")) capabilities.vision = true;
          const contextLength = Object.entries(
            parsed.data.model_info || {},
          ).find(
            ([key, value]) =>
              key.endsWith(".context_length") && isSafeTokenLimit(value),
          )?.[1];
          if (isSafeTokenLimit(contextLength)) {
            capabilities.maxContextTokens = contextLength;
          }
          target[model] = capabilities;
        } catch {
          // One unsupported or damaged model must not hide the remaining local catalog.
        }
      }),
    );
  }
}

function classifyModelKind(
  entry: z.infer<typeof ModelEntrySchema>,
  declared: Record<string, unknown>,
  inputModalities: Set<string>,
  outputModalities: Set<string>,
  parameters: Set<string>,
): NonNullable<DiscoveredModelCapabilities["kind"]> {
  const descriptors = collectStrings(
    entry.type,
    entry.kind,
    entry.task,
    entry.endpoint,
    declared.type,
    declared.kind,
    declared.task,
  );
  const hasDescriptor = (...values: string[]) =>
    values.some((value) => descriptors.has(value));

  if (hasDescriptor("embedding", "embeddings", "feature-extraction")) {
    return "embedding";
  }
  if (hasDescriptor("rerank", "reranking")) return "rerank";
  if (hasDescriptor("search", "web-search")) return "search";
  if (hasDescriptor("video", "video-generation", "text-to-video")) {
    return "video";
  }
  if (
    hasDescriptor(
      "audio",
      "speech",
      "text-to-speech",
      "transcription",
      "speech-to-text",
    )
  ) {
    return "audio";
  }
  if (hasDescriptor("image", "image-generation", "text-to-image")) {
    return "image";
  }
  if (
    hasDescriptor(
      "chat",
      "chat-completion",
      "chat.completions",
      "completion",
      "text-generation",
    )
  ) {
    return "chat";
  }

  if (outputModalities.has("embedding")) return "embedding";
  if (outputModalities.has("video") && !outputModalities.has("text")) {
    return "video";
  }
  if (outputModalities.has("audio") && !outputModalities.has("text")) {
    return "audio";
  }
  if (outputModalities.has("image") && !outputModalities.has("text")) {
    return "image";
  }
  if (
    outputModalities.has("text") ||
    parameters.has("messages") ||
    parameters.has("tools") ||
    inputModalities.has("text")
  ) {
    return "chat";
  }
  return "unknown";
}

function isSafeTokenLimit(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= 10_000_000
  );
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function collectStrings(...values: unknown[]): Set<string> {
  const result = new Set<string>();
  for (const value of values) {
    if (typeof value === "string") result.add(value.toLowerCase());
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") result.add(item.toLowerCase());
      }
    }
  }
  return result;
}

function copyBooleanCapability(
  source: Record<string, unknown>,
  sourceKey: string,
  target: DiscoveredModelCapabilities,
  targetKey: keyof Pick<
    DiscoveredModelCapabilities,
    "streaming" | "toolCalls" | "jsonMode" | "thinking" | "vision"
  >,
): void {
  if (typeof source[sourceKey] === "boolean") {
    target[targetKey] = source[sourceKey];
  }
}
