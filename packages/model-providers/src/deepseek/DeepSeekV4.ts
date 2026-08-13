export const DEEPSEEK_V4_FLASH = "deepseek-v4-flash";
export const DEEPSEEK_V4_PRO = "deepseek-v4-pro";
export const DEEPSEEK_V4_FLASH_VERSION = "DeepSeek-V4-Flash-0731";
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
  canonicalModel: typeof DEEPSEEK_V4_FLASH | typeof DEEPSEEK_V4_PRO;
  modelVersion: string;
  supportsResponses: boolean;
  reasoningEfforts: readonly DeepSeekNativeReasoningEffort[];
  parallelToolCalls: true;
  officialRequestModel: boolean;
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

/** Resolves official V4 models and their temporary legacy aliases. */
export function getDeepSeekV4ModelProfile(
  model: string,
): DeepSeekV4ModelProfile | undefined {
  const normalized = model
    .trim()
    .toLowerCase()
    .replace(/\[1m\]$/, "");
  const leaf = normalized.split("/").at(-1) ?? normalized;
  const officialRequestModel = leaf === normalized;
  if (leaf === DEEPSEEK_V4_FLASH || leaf === `${DEEPSEEK_V4_FLASH}-0731`) {
    return {
      lane: "flash",
      legacyAlias: false,
      optimizedThinkingDefault: true,
      canonicalModel: DEEPSEEK_V4_FLASH,
      modelVersion: DEEPSEEK_V4_FLASH_VERSION,
      supportsResponses: true,
      reasoningEfforts: DEEPSEEK_REASONING_EFFORTS,
      parallelToolCalls: true,
      officialRequestModel: officialRequestModel && leaf === DEEPSEEK_V4_FLASH,
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
    };
  }
  if (leaf === "deepseek-chat") {
    return {
      lane: "flash",
      legacyAlias: true,
      optimizedThinkingDefault: false,
      canonicalModel: DEEPSEEK_V4_FLASH,
      modelVersion: DEEPSEEK_V4_FLASH_VERSION,
      supportsResponses: true,
      reasoningEfforts: DEEPSEEK_REASONING_EFFORTS,
      parallelToolCalls: true,
      officialRequestModel,
    };
  }
  if (leaf === "deepseek-reasoner") {
    return {
      lane: "flash",
      legacyAlias: true,
      optimizedThinkingDefault: true,
      canonicalModel: DEEPSEEK_V4_FLASH,
      modelVersion: DEEPSEEK_V4_FLASH_VERSION,
      supportsResponses: true,
      reasoningEfforts: DEEPSEEK_REASONING_EFFORTS,
      parallelToolCalls: true,
      officialRequestModel,
    };
  }
  return undefined;
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
  input: { isComplexTask: boolean; isRepairTurn: boolean },
): {
  enabled: boolean;
  effort: DeepSeekNativeReasoningEffort;
  budgetTokens: number;
} {
  if (profile.legacyAlias) {
    return profile.optimizedThinkingDefault
      ? { enabled: true, effort: "high", budgetTokens: 4096 }
      : { enabled: false, effort: "high", budgetTokens: 0 };
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
