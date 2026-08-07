import { describe, expect, it } from "vitest";
import {
  DEEPSEEK_V4_FLASH,
  DEEPSEEK_V4_PRO,
  getDeepSeekReasoningEffort,
  getDeepSeekThinkingPolicy,
  getDeepSeekV4ModelProfile,
  isOfficialDeepSeekApi,
} from "./DeepSeekV4.js";

describe("DeepSeek V4 model profile", () => {
  it("recognizes only the exact official HTTPS endpoint", () => {
    expect(isOfficialDeepSeekApi("https://api.deepseek.com")).toBe(true);
    expect(isOfficialDeepSeekApi("https://api.deepseek.com/v1")).toBe(true);
    expect(
      isOfficialDeepSeekApi("https://api.deepseek.com:443/anthropic"),
    ).toBe(true);
    expect(isOfficialDeepSeekApi("http://api.deepseek.com")).toBe(false);
    expect(isOfficialDeepSeekApi("https://api.deepseek.com.evil.test")).toBe(
      false,
    );
    expect(isOfficialDeepSeekApi("https://api.deepseek.com:444")).toBe(false);
    expect(isOfficialDeepSeekApi("https://api.deepseek.com?key=secret")).toBe(
      false,
    );
    expect(isOfficialDeepSeekApi("https://api.deepseek.com/#fragment")).toBe(
      false,
    );
    expect(isOfficialDeepSeekApi("https://lookalike@api.deepseek.com/v1")).toBe(
      false,
    );
  });

  it("canonicalizes Claude Code suffixes and preserves alias thinking modes", () => {
    expect(getDeepSeekV4ModelProfile("deepseek-v4-pro[1m]")).toMatchObject({
      canonicalModel: DEEPSEEK_V4_PRO,
      lane: "pro",
      optimizedThinkingDefault: true,
    });
    expect(getDeepSeekV4ModelProfile("deepseek-chat")).toMatchObject({
      canonicalModel: DEEPSEEK_V4_FLASH,
      legacyAlias: true,
      optimizedThinkingDefault: false,
    });
    expect(getDeepSeekV4ModelProfile("deepseek-reasoner")).toMatchObject({
      canonicalModel: DEEPSEEK_V4_FLASH,
      legacyAlias: true,
      optimizedThinkingDefault: true,
    });
    expect(
      getDeepSeekV4ModelProfile("deepseek-ai/deepseek-v4-flash-0731"),
    ).toMatchObject({
      lane: "flash",
      modelVersion: "DeepSeek-V4-Flash-0731",
      optimizedThinkingDefault: true,
      officialRequestModel: false,
    });
  });

  it("maps legacy low input to the official high/max effort levels", () => {
    expect(getDeepSeekReasoningEffort(1024)).toBe("high");
    expect(getDeepSeekReasoningEffort(4096)).toBe("high");
    expect(getDeepSeekReasoningEffort(8192)).toBe("max");
    expect(getDeepSeekReasoningEffort(8192, "low")).toBe("high");
  });

  it("uses the official high default for Flash and max for repair", () => {
    const flash = getDeepSeekV4ModelProfile(DEEPSEEK_V4_FLASH)!;
    expect(
      getDeepSeekThinkingPolicy(flash, {
        isComplexTask: false,
        isRepairTurn: false,
      }),
    ).toEqual({ enabled: true, effort: "high", budgetTokens: 4096 });
    expect(
      getDeepSeekThinkingPolicy(flash, {
        isComplexTask: true,
        isRepairTurn: false,
      }),
    ).toEqual({ enabled: true, effort: "high", budgetTokens: 4096 });
    expect(
      getDeepSeekThinkingPolicy(flash, {
        isComplexTask: true,
        isRepairTurn: true,
      }),
    ).toEqual({ enabled: true, effort: "max", budgetTokens: 8192 });
  });
});
