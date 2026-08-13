import {
  getDeepSeekThinkingPolicy,
  getDeepSeekV4ModelProfile,
  type DeepSeekV4ModelProfile,
} from "./deepseek/DeepSeekV4.js";
import type { ReasoningEffort } from "./types.js";

export type ModelAdaptation =
  | {
      family: "deepseek-v4";
      requestedModel: string;
      deepSeekV4: DeepSeekV4ModelProfile;
    }
  | { family: "generic"; requestedModel: string };

export interface ModelThinkingContext {
  isComplexTask: boolean;
  isRepairTurn: boolean;
}

export interface ModelThinkingPolicy {
  enabled: boolean;
  effort?: ReasoningEffort;
  budgetTokens: number;
}

/**
 * Resolves model-specific behavior independently from the provider hostname.
 * Unknown models deliberately stay on the generic compatible path.
 */
export function resolveModelAdaptation(model: string): ModelAdaptation {
  const deepSeekV4 = getDeepSeekV4ModelProfile(model);
  return deepSeekV4
    ? { family: "deepseek-v4", requestedModel: model, deepSeekV4 }
    : { family: "generic", requestedModel: model };
}

/** Returns DeepSeek semantics for aliases and namespaced gateway model IDs. */
export function resolveDeepSeekModelProfile(
  model: string,
): DeepSeekV4ModelProfile | undefined {
  const adaptation = resolveModelAdaptation(model);
  return adaptation.family === "deepseek-v4"
    ? adaptation.deepSeekV4
    : undefined;
}

/** Resolves the generic turn policy without exposing a provider family to core. */
export function resolveModelThinkingPolicy(
  model: string,
  context: ModelThinkingContext,
): ModelThinkingPolicy | undefined {
  const adaptation = resolveModelAdaptation(model);
  if (adaptation.family === "deepseek-v4") {
    return getDeepSeekThinkingPolicy(adaptation.deepSeekV4, context);
  }
  if (context.isRepairTurn) {
    return { enabled: true, budgetTokens: 8192 };
  }
  if (context.isComplexTask) {
    return { enabled: true, budgetTokens: 4096 };
  }
  return undefined;
}

/** Returns the pricing/configuration identity for any model family. */
export function resolveModelCanonicalName(model: string): string {
  const adaptation = resolveModelAdaptation(model);
  return adaptation.family === "deepseek-v4"
    ? adaptation.deepSeekV4.canonicalModel
    : model;
}
