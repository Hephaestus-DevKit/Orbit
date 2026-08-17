import { resolveDeepSeekModelProfile } from "./ModelAdaptation.js";
import type {
  ModelCapabilities,
  ModelChatInput,
  ModelEvent,
  ModelProvider,
} from "./types.js";

/**
 * Keeps a gateway's generic models generic while automatically sending any
 * DeepSeek V4 model through the DeepSeek-specific serializer/retry policy.
 * This is selected from model identity, not from a fragile provider id.
 */
export class ModelAwareProvider implements ModelProvider {
  public readonly id: string;
  public readonly type: ModelProvider["type"];
  public readonly capabilities: ModelCapabilities;

  public constructor(
    private readonly generic: ModelProvider,
    private readonly deepSeek: ModelProvider,
  ) {
    this.id = generic.id;
    this.type = generic.type;
    this.capabilities = generic.capabilities;
  }

  public async initialize(): Promise<void> {
    // Preheat only the active generic transport. The DeepSeek lane is still
    // fully initialized by its own lazy request path when a DeepSeek model is
    // selected, avoiding duplicate gateway probes at startup.
    await this.generic.initialize?.();
  }

  public chat(input: ModelChatInput): AsyncIterable<ModelEvent> {
    return this.select(input.model).chat(input);
  }

  public getModelCapabilities(model: string): ModelCapabilities {
    return (
      this.select(model).getModelCapabilities?.(model) ??
      this.generic.capabilities
    );
  }

  public countTokens(input: ModelChatInput): Promise<number> {
    const provider = this.select(input.model);
    if (!provider.countTokens) return Promise.resolve(0);
    return provider.countTokens(input);
  }

  public embed(
    texts: string[],
    options?: { model?: string },
  ): Promise<number[][]> {
    const provider =
      options?.model && resolveDeepSeekModelProfile(options.model)
        ? this.deepSeek
        : this.generic;
    if (!provider.embed)
      return Promise.reject(
        new Error(`Provider ${provider.id} does not support embeddings.`),
      );
    return provider.embed(texts, options);
  }

  public complete(
    prompt: string,
    options?: {
      model?: string;
      maxTokens?: number;
      stop?: string[];
      suffix?: string;
      abortSignal?: AbortSignal;
    },
  ): Promise<string> {
    const provider = options?.model ? this.select(options.model) : this.generic;
    if (!provider.complete)
      return Promise.reject(
        new Error(`Provider ${provider.id} does not support completion.`),
      );
    return provider.complete(prompt, options);
  }

  private select(model: string): ModelProvider {
    return resolveDeepSeekModelProfile(model) ? this.deepSeek : this.generic;
  }
}
