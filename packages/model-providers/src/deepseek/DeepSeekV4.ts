/** Current official Flash endpoint. Retired Flash IDs are not request aliases. */
export const DEEPSEEK_FLASH = "deepseek-flash";
export const DEEPSEEK_FLASH_VERSION = "DeepSeek-V4.1-Flash";
export const DEEPSEEK_V4_PRO = "deepseek-v4-pro";
export const DEEPSEEK_V4_PRO_VERSION = "DeepSeek-V4-Pro-0813";
import type { ReasoningEffort } from "../types.js";

export const DEEPSEEK_V4_CONTEXT_TOKENS = 1_000_000;
export const DEEPSEEK_V4_MAX_OUTPUT_TOKENS = 384_000;
export const DEEPSEEK_V4_EFFECTIVE_CONTEXT_PERCENT = 0.95;

export type DeepSeekV4Lane = "flash" | "pro";
export type DeepSeekReasoningEffort = ReasoningEffort;
export type DeepSeekNativeReasoningEffort = "low" | "high" | "max";

export interface DeepSeekV4ModelProfile {
  lane: DeepSeekV4Lane;
  legacyAlias: boolean;
  optimizedThinkingDefault: boolean;
  canonicalModel: typeof DEEPSEEK_FLASH | typeof DEEPSEEK_V4_PRO;
  modelVersion: string;
  supportsResponses: boolean;
  reasoningEfforts: readonly DeepSeekNativeReasoningEffort[];
  parallelToolCalls: true;
  officialRequestModel: boolean;
  vision: boolean;
}

const DEEPSEEK_REASONING_EFFORTS = ["low", "high", "max"] as const;

/** Detects the official hosted DeepSeek API without trusting look-alike hosts. */
export function isOfficialDeepSeekApi(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return (
      url.protocol === "https:" &&
      url.hostname === "api.deepseek.com" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      (url.port === "" || url.port === "443")
    );
  } catch {
    return false;
  }
}

/** Resolves current model profiles, including namespaced gateway identities. */
export function getDeepSeekV4ModelProfile(
  model: string,
): DeepSeekV4ModelProfile | undefined {
  const normalized = model
    .trim()
    .toLowerCase()
    .replace(/\[1m\]$/, "");
  const leaf = normalized.split("/").at(-1) ?? normalized;
  const officialRequestModel = leaf === normalized;
  if (leaf === DEEPSEEK_FLASH) {
    return {
      lane: "flash",
      legacyAlias: false,
      optimizedThinkingDefault: true,
      canonicalModel: DEEPSEEK_FLASH,
      modelVersion: DEEPSEEK_FLASH_VERSION,
      supportsResponses: true,
      reasoningEfforts: DEEPSEEK_REASONING_EFFORTS,
      parallelToolCalls: true,
      officialRequestModel,
      vision: true,
    };
  }
  if (leaf === DEEPSEEK_V4_PRO || leaf === `${DEEPSEEK_V4_PRO}-0813`) {
    return {
      lane: "pro",
      legacyAlias: false,
      optimizedThinkingDefault: true,
      canonicalModel: DEEPSEEK_V4_PRO,
      modelVersion: DEEPSEEK_V4_PRO_VERSION,
      supportsResponses: true,
      reasoningEfforts: DEEPSEEK_REASONING_EFFORTS,
      parallelToolCalls: true,
      officialRequestModel: officialRequestModel && leaf === DEEPSEEK_V4_PRO,
      vision: false,
    };
  }
  return undefined;
}

/** Validates an official request model; never silently substitutes a retired ID. */
export function resolveOfficialDeepSeekRequestModel(
  model = DEEPSEEK_FLASH,
): string {
  const profile = getDeepSeekV4ModelProfile(model);
  if (!profile?.officialRequestModel) {
    throw new Error(
      "Unsupported or retired model for the official DeepSeek API. Set your model to deepseek-flash or deepseek-v4-pro.",
    );
  }
  return profile.canonicalModel;
}

export function getDeepSeekReasoningEffort(
  budgetTokens = 4096,
  explicitEffort?: DeepSeekReasoningEffort,
): DeepSeekNativeReasoningEffort {
  if (explicitEffort === "low" || explicitEffort === "max") {
    return explicitEffort;
  }
  if (explicitEffort) return "high";
  if (budgetTokens >= 8192) return "max";
  return "high";
}

/** Chooses the native V4 reasoning policy for one agent turn. */
export function getDeepSeekThinkingPolicy(
  profile: DeepSeekV4ModelProfile,
  input: {
    isComplexTask: boolean;
    isRepairTurn: boolean;
    requestedEffort?: DeepSeekReasoningEffort;
  },
): {
  enabled: boolean;
  effort: DeepSeekNativeReasoningEffort;
  budgetTokens: number;
} {
  if (input.requestedEffort) {
    const effort = getDeepSeekReasoningEffort(4096, input.requestedEffort);
    return {
      enabled: true,
      effort,
      budgetTokens: effort === "low" ? 2_048 : effort === "max" ? 8_192 : 4_096,
    };
  }
  if (input.isRepairTurn) {
    return { enabled: true, effort: "max", budgetTokens: 8192 };
  }
  if (input.isComplexTask || profile.lane === "pro") {
    return { enabled: true, effort: "high", budgetTokens: 4096 };
  }
  return {
    enabled: true,
    effort: "low",
    budgetTokens: 2048,
  };
}
