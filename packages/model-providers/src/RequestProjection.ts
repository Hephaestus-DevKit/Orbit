import { estimateTokenCount } from "@orbit-build/shared";
import type {
  ModelChatInput,
  ModelProvider,
  OrbitContentBlock,
  OrbitMessage,
} from "./types.js";
import { zodToJsonSchema } from "./utils.js";

export type ImageTokenEstimator = (
  image: Extract<OrbitContentBlock, { type: "image" }>,
) => number;

/** Local input projection shared by context compaction and request admission. */
export function projectHistoryTokens(
  history: readonly OrbitMessage[],
  estimateImageTokens: ImageTokenEstimator = () => 4096,
): number {
  let imageTokens = 0;
  const messages = history.map(({ role, content }) => ({
    role,
    content: content.map((block) => {
      if (block.type !== "image") return block;
      const estimate = estimateImageTokens(block);
      imageTokens +=
        Number.isFinite(estimate) && estimate > 0 ? Math.ceil(estimate) : 4096;
      return { type: "image", mediaType: block.mediaType };
    }),
  }));
  return estimateTokenCount(JSON.stringify(messages)) + imageTokens;
}

/** Resolve synchronous image accounting without network calls or history mutation. */
export function modelImageTokenEstimator(
  provider: Pick<ModelProvider, "estimateImageTokens">,
  model: string,
): ImageTokenEstimator {
  return (image) => provider.estimateImageTokens?.(image, model) ?? 4096;
}

/** Includes system and tool schemas; binary transport bytes are never text tokens. */
export function projectModelInputTokens(
  input: ModelChatInput,
  provider: Pick<ModelProvider, "estimateImageTokens"> = {},
): number {
  return (
    projectHistoryTokens(
      input.messages,
      modelImageTokenEstimator(provider, input.model),
    ) +
    estimateTokenCount(
      JSON.stringify({
        system: input.system,
        tools: input.tools?.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.inputJsonSchema ?? zodToJsonSchema(tool.inputSchema),
        })),
      }),
    ) +
    64
  );
}
