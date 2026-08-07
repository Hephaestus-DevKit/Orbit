type ProviderConfigLike = {
  type?: string;
  models?: string[];
  modelCapabilities?: Record<string, { kind?: string } | undefined>;
};

type ConfigLike = {
  provider?: { default?: string };
  providers?: Record<string, ProviderConfigLike | undefined>;
};

const DEEPSEEK_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"];

export const DEEPSEEK_LEGACY_ALIAS_DEPRECATION = "2026-07-24T15:59:00Z";

const DEEPSEEK_LEGACY_ALIAS_MIGRATIONS: Record<
  string,
  { model: string; thinking: "disabled" | "high" }
> = {
  "deepseek-chat": { model: "deepseek-v4-flash", thinking: "disabled" },
  "deepseek-reasoner": { model: "deepseek-v4-flash", thinking: "high" },
};

const OPENAI_MODELS = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"];

const ANTHROPIC_MODELS = [
  "claude-fable-5",
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
];

const OLLAMA_MODELS = ["qwen2.5-coder:7b", "qwen2.5-coder:1.5b", "llama3"];

function uniqueModels(models: string[]): string[] {
  return Array.from(new Set(models.map((m) => m.trim()).filter(Boolean)));
}

const NON_CHAT_MODEL_KINDS = new Set([
  "embedding",
  "image",
  "video",
  "audio",
  "search",
  "rerank",
]);

type NonChatModelKind =
  | "embedding"
  | "image"
  | "video"
  | "audio"
  | "search"
  | "rerank";

/**
 * Apply narrow provider-catalog fallbacks when an OpenAI-compatible endpoint
 * returns only opaque IDs. These rules are intentionally provider-specific:
 * generic gateways keep unknown models available until metadata says otherwise.
 */
export function inferProviderCatalogKind(
  providerId: string | undefined,
  model: string,
): NonChatModelKind | undefined {
  if (providerId?.trim().toLowerCase() !== "tokendance") return undefined;

  const id = model.trim().toLowerCase();
  if (/(?:^|[-_.\/])(?:embedding|embed)(?:$|[-_.\/])/.test(id)) {
    return "embedding";
  }
  if (/(?:^|[-_.\/])rerank(?:$|[-_.\/])/.test(id)) return "rerank";
  if (
    /^(?:happyhorse|seedance|kling)(?:$|[-_.\/])/.test(id) ||
    /(?:^|[-_.\/])(?:text-to-video|image-to-video)(?:$|[-_.\/])/.test(id)
  ) {
    return "video";
  }
  if (
    /(?:^|[-_.\/])(?:tts|speech|voiceclone|voice-design|voicedesign)(?:$|[-_.\/])/.test(
      id,
    )
  ) {
    return "audio";
  }
  if (
    /^(?:seedream)(?:$|[-_.\/])/.test(id) ||
    /(?:^|[-_.\/])(?:text-to-image|image-generation)(?:$|[-_.\/])/.test(id)
  ) {
    return "image";
  }
  if (
    /^(?:bocha-web-search|web-search|web-reader|unifuncs-web-search|unifuncs-web-reader)(?:$|[-_.\/])/.test(
      id,
    )
  ) {
    return "search";
  }
  return undefined;
}

/** Keep unknown models available, but never route a known non-chat endpoint. */
export function isChatModelCandidate(
  config: ConfigLike | undefined,
  providerId: string | undefined,
  model: string,
): boolean {
  const kind = providerId
    ? config?.providers?.[providerId]?.modelCapabilities?.[model]?.kind
    : undefined;
  const resolvedKind =
    kind && kind !== "unknown"
      ? kind
      : inferProviderCatalogKind(providerId, model);
  return !resolvedKind || !NON_CHAT_MODEL_KINDS.has(resolvedKind);
}

export function getProviderModelCandidates(
  config: ConfigLike | undefined,
  providerId = config?.provider?.default,
): string[] {
  const providerConfig = providerId
    ? config?.providers?.[providerId]
    : undefined;
  const configuredModels = Array.isArray(providerConfig?.models)
    ? uniqueModels(providerConfig.models).filter((model) =>
        isChatModelCandidate(config, providerId, model),
      )
    : [];
  if (configuredModels.length > 0) {
    return configuredModels;
  }

  const providerType = providerConfig?.type;
  if (providerId?.toLowerCase().includes("deepseek")) {
    return DEEPSEEK_MODELS;
  }
  if (providerType === "anthropic" || providerType === "anthropic-compatible") {
    return ANTHROPIC_MODELS;
  }
  if (providerType === "openai") {
    return OPENAI_MODELS;
  }
  if (providerType === "openai-compatible") {
    return uniqueModels([...OPENAI_MODELS, ...DEEPSEEK_MODELS]);
  }
  if (providerType === "ollama") {
    return OLLAMA_MODELS;
  }
  return uniqueModels([
    ...DEEPSEEK_MODELS,
    ...OPENAI_MODELS,
    ...ANTHROPIC_MODELS,
  ]);
}

export function isDeprecatedDeepSeekAlias(model: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    DEEPSEEK_LEGACY_ALIAS_MIGRATIONS,
    model.trim().toLowerCase(),
  );
}

export function getDeepSeekAliasReplacement(model: string): string | undefined {
  return getDeepSeekAliasMigration(model)?.model;
}

export function getDeepSeekAliasMigration(
  model: string,
): { model: string; thinking: "disabled" | "high" } | undefined {
  return DEEPSEEK_LEGACY_ALIAS_MIGRATIONS[model.trim().toLowerCase()];
}

export function describeDeprecatedDeepSeekAliases(models: string[]): string {
  const deprecated = uniqueModels(models).filter(isDeprecatedDeepSeekAlias);
  if (deprecated.length === 0) {
    return "No deprecated deepseek-chat/deepseek-reasoner aliases in configured model roles.";
  }

  const replacements = deprecated
    .map((model) => {
      const migration = getDeepSeekAliasMigration(model)!;
      return `${model} -> ${migration.model} (thinking ${migration.thinking})`;
    })
    .join(", ");
  return `Deprecated DeepSeek aliases configured: ${replacements}. They are scheduled for removal after ${DEEPSEEK_LEGACY_ALIAS_DEPRECATION}; prefer deepseek-v4-flash/pro.`;
}

export function formatModelOptionLabel(model: string): string {
  const lower = model.toLowerCase();
  const migration = getDeepSeekAliasMigration(model);
  if (migration) {
    return `${model} (deprecated -> ${migration.model}; thinking ${migration.thinking})`;
  }
  if (lower.includes("deepseek-v4-flash")) {
    return `${model} (0731 / Responses native; thinking high by default, max for repair)`;
  }
  if (lower.includes("deepseek-v4-pro")) {
    return `${model} (quality / pro; thinking available)`;
  }
  if (lower.includes("gpt-5.5") || lower.includes("gpt-5.4")) {
    return `${model} (OpenAI)`;
  }
  if (lower.includes("claude")) {
    return `${model} (Anthropic)`;
  }
  return model;
}
