import {
  OpenAIProvider,
  DeepSeekOpenAIProvider,
  OllamaProvider,
  type ModelProvider,
} from "@orbit-build/model-providers";
import type { OrbitConfig } from "@orbit-build/config";

function getAutocompleteProvider(
  providerId: string,
  config: OrbitConfig,
): ModelProvider {
  const providerConfig = config.providers?.[providerId];
  if (!providerConfig) {
    if (providerId === "ollama") {
      return new OllamaProvider();
    }
    return new DeepSeekOpenAIProvider(
      process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || "no-key",
    );
  }

  const apiKey =
    providerConfig.apiKey ||
    (providerConfig.apiKeyEnv
      ? process.env[providerConfig.apiKeyEnv]
      : undefined);
  const baseUrl = providerConfig.baseUrl;
  const providerOptions = {
    id: providerId,
    apiKeyEnv: providerConfig.apiKeyEnv,
    apiKeyHeader: providerConfig.apiKeyHeader,
    apiKeyPrefix: providerConfig.apiKeyPrefix,
    headers: providerConfig.headers,
    requestTimeoutMs: providerConfig.requestTimeoutMs,
    streamTimeoutMs: providerConfig.streamTimeoutMs,
    maxRetries: providerConfig.maxRetries,
    disablePreheat: providerConfig.disablePreheat,
    extraBody: providerConfig.extraBody,
    capabilities: providerConfig.capabilities,
    modelCapabilities: providerConfig.modelCapabilities,
  };

  switch (providerConfig.type) {
    case "openai":
      return new OpenAIProvider(apiKey, baseUrl, providerOptions);
    case "ollama":
      return new OllamaProvider(baseUrl);
    case "openai-compatible":
    case "anthropic-compatible":
    default:
      return new DeepSeekOpenAIProvider(apiKey, baseUrl, providerOptions);
  }
}

function safeDecodeURI(uri: string): string {
  try {
    return decodeURIComponent(uri);
  } catch {
    return uri;
  }
}

function getPathCommentHeader(windowId: string, cwd: string): string {
  if (!windowId || windowId === "default") {
    return "";
  }

  let filePath = windowId;
  if (filePath.startsWith("file:///")) {
    const afterScheme = safeDecodeURI(filePath.substring(8));
    if (/^[a-zA-Z]:/.test(afterScheme)) {
      filePath = afterScheme;
    } else {
      filePath = safeDecodeURI(filePath.substring(7));
    }
  } else if (filePath.startsWith("file://")) {
    filePath = safeDecodeURI(filePath.substring(7));
  }

  filePath = filePath.replace(/\\/g, "/");
  const normalizedCwd = cwd.replace(/\\/g, "/");

  let displayPath = filePath;
  if (filePath.toLowerCase().startsWith(normalizedCwd.toLowerCase() + "/")) {
    displayPath = filePath.substring(normalizedCwd.length + 1);
  } else {
    const parts = filePath.split("/");
    displayPath = parts.slice(-2).join("/");
  }

  const ext = displayPath.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "py":
    case "yaml":
    case "yml":
    case "sh":
    case "rb":
    case "pl":
      return `# Path: ${displayPath}\n`;
    case "html":
    case "xml":
    case "vue":
      return `<!-- Path: ${displayPath} -->\n`;
    case "css":
    case "scss":
    case "less":
      return `/* Path: ${displayPath} */\n`;
    default:
      return `// Path: ${displayPath}\n`;
  }
}

export class AutocompleteEngine {
  private activeRequests = new Map<string, AbortController>();
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private debounceResolvers = new Map<string, (val: string) => void>();
  private providerCache = new WeakMap<
    OrbitConfig,
    Map<string, ModelProvider>
  >();

  constructor(private cwd: string = process.cwd()) {}

  private getCachedProvider(
    providerId: string,
    config: OrbitConfig,
  ): ModelProvider {
    let providers = this.providerCache.get(config);
    if (!providers) {
      providers = new Map<string, ModelProvider>();
      this.providerCache.set(config, providers);
    }
    const key = providerId;
    if (!providers.has(key)) {
      providers.set(key, getAutocompleteProvider(providerId, config));
    }
    return providers.get(key)!;
  }

  /**
   * Generates local FIM code autocomplete suggestions.
   */
  public async autocomplete(
    prefix: string,
    suffix: string,
    config: OrbitConfig,
    windowId = "default",
  ): Promise<string> {
    if (!config.autocomplete?.enabled) {
      return "";
    }

    // Debounce: Cancel previous autocomplete timer and resolve its promise
    const prevTimer = this.debounceTimers.get(windowId);
    if (prevTimer) {
      clearTimeout(prevTimer);
    }
    const prevResolve = this.debounceResolvers.get(windowId);
    if (prevResolve) {
      prevResolve("");
      this.debounceResolvers.delete(windowId);
    }

    // Cancel previous autocomplete request for this specific window if it is still running
    const active = this.activeRequests.get(windowId);
    if (active) {
      active.abort();
    }

    const controller = new AbortController();
    this.activeRequests.set(windowId, controller);
    const signal = controller.signal;

    const debounceMs =
      config.autocomplete?.debounceMs !== undefined
        ? config.autocomplete.debounceMs
        : 150;

    return new Promise<string>((resolve) => {
      this.debounceResolvers.set(windowId, resolve);

      const timer = setTimeout(async () => {
        if (this.debounceTimers.get(windowId) === timer) {
          this.debounceTimers.delete(windowId);
        }
        this.debounceResolvers.delete(windowId);
        if (signal.aborted) {
          resolve("");
          return;
        }

        const providerId = config.autocomplete.provider || "ollama";
        const modelName = config.autocomplete.model || "qwen2.5-coder:1.5b";

        try {
          const provider = this.getCachedProvider(providerId, config);
          if (typeof provider.complete !== "function") {
            resolve("");
            return;
          }

          // Prepend path comment header to prefix for FIM context enhancement
          const header = getPathCommentHeader(windowId, this.cwd);
          const enhancedPrefix = header ? header + prefix : prefix;

          // Detect if this is the official DeepSeek API
          const isOfficialDeepSeek =
            providerId === "deepseek-openai" ||
            (config.providers?.[providerId]?.baseUrl || "").includes(
              "api.deepseek.com",
            );

          // Detect and format FIM Prompt template based on the model name
          let fimPrompt = "";
          let stopWords: string[] = [];

          const lowercaseModel = modelName.toLowerCase();
          if (lowercaseModel.includes("deepseek")) {
            fimPrompt = `<｜fim begin｜>${enhancedPrefix}<｜fim hole｜>${suffix}<｜fim end｜>`;
            stopWords = [
              "<｜fim begin｜>",
              "<｜fim hole｜>",
              "<｜fim end｜>",
              "\n\n",
            ];
          } else if (lowercaseModel.includes("qwen")) {
            fimPrompt = `<|fim_prefix|>${enhancedPrefix}<|fim_suffix|>${suffix}<|fim_middle|>`;
            stopWords = [
              "<|fim_prefix|>",
              "<|fim_suffix|>",
              "<|fim_middle|>",
              "<|fim_pad|>",
              "<file_sep>",
              "\n\n",
            ];
          } else {
            fimPrompt = `<fim_prefix>${enhancedPrefix}<fim_suffix>${suffix}<fim_middle>`;
            stopWords = [
              "<fim_prefix>",
              "<fim_suffix>",
              "<fim_middle>",
              "<fim_pad>",
              "<file_sep>",
              "\n\n",
            ];
          }

          let localPromise: Promise<string> = Promise.resolve("");
          let cloudPromise: Promise<string> = Promise.resolve("");

          const speculative = config.autocomplete.speculative;
          const speculativeEnabled = speculative?.enabled === true;
          if (speculativeEnabled && speculative) {
            const specProviderId = speculative.provider || "ollama";
            const specModelName = speculative.model || "qwen2.5-coder:0.5b";
            const isSpecOfficialDeepSeek =
              specProviderId === "deepseek-openai" ||
              (config.providers?.[specProviderId]?.baseUrl || "").includes(
                "api.deepseek.com",
              );
            try {
              const specProvider = this.getCachedProvider(
                specProviderId,
                config,
              );
              if (typeof specProvider.complete === "function") {
                if (isSpecOfficialDeepSeek) {
                  localPromise = specProvider
                    .complete(enhancedPrefix, {
                      model: specModelName,
                      maxTokens: 32,
                      stop: stopWords,
                      suffix: suffix,
                      abortSignal: signal,
                    })
                    .catch(() => "");
                } else {
                  localPromise = specProvider
                    .complete(fimPrompt, {
                      model: specModelName,
                      maxTokens: 32,
                      stop: stopWords,
                      abortSignal: signal,
                    })
                    .catch(() => "");
                }
              }
            } catch {
              // Ignore spec provider init issues
            }
          }

          if (isOfficialDeepSeek) {
            cloudPromise = provider.complete(enhancedPrefix, {
              model: modelName,
              maxTokens: 64,
              stop: stopWords,
              suffix: suffix,
              abortSignal: signal,
            });
          } else {
            cloudPromise = provider.complete(fimPrompt, {
              model: modelName,
              maxTokens: 64,
              stop: stopWords,
              abortSignal: signal,
            });
          }

          if (speculativeEnabled && speculative) {
            const specTimeout =
              speculative.timeoutMs !== undefined ? speculative.timeoutMs : 150;
            let speculativeTimer: NodeJS.Timeout | undefined;
            const timeoutPromise = new Promise<string>((resolveTimeout) => {
              speculativeTimer = setTimeout(
                () => resolveTimeout("__TIMEOUT__"),
                specTimeout,
              );
              speculativeTimer.unref?.();
            });
            let winner: string;
            try {
              winner = await Promise.race([
                cloudPromise.catch(() => ""),
                timeoutPromise,
              ]);
            } finally {
              if (speculativeTimer) clearTimeout(speculativeTimer);
            }

            if (winner !== "__TIMEOUT__" && winner.trim() !== "") {
              resolve(winner);
            } else {
              const localResult = await localPromise;
              if (localResult.trim() !== "") {
                resolve(localResult);
              } else {
                resolve(await cloudPromise.catch(() => ""));
              }
            }
          } else {
            const completed = await cloudPromise;
            resolve(completed);
          }
        } catch {
          resolve("");
        } finally {
          if (this.activeRequests.get(windowId) === controller) {
            this.activeRequests.delete(windowId);
          }
        }
      }, debounceMs);

      this.debounceTimers.set(windowId, timer);
    });
  }

  /** Cancel outstanding completions and release timers held by the engine. */
  public dispose(): void {
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    for (const resolve of this.debounceResolvers.values()) resolve("");
    for (const controller of this.activeRequests.values()) controller.abort();
    this.debounceTimers.clear();
    this.debounceResolvers.clear();
    this.activeRequests.clear();
    this.providerCache = new WeakMap();
  }
}
