/**
 * @deprecated Import `OpenAICompatibleProvider` instead. DeepSeek behavior is
 * selected by model identity inside the generic transport; this alias remains
 * for source compatibility with Orbit releases before 0.8.0.
 */
export {
  OpenAICompatibleProvider,
  OpenAICompatibleProvider as DeepSeekOpenAIProvider,
} from "../openai-compatible/OpenAICompatibleProvider.js";
