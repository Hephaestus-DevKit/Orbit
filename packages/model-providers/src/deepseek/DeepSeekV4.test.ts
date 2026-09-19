import { describe, expect, it } from "vitest";
import {
  DEEPSEEK_FLASH,
  DEEPSEEK_V4_PRO,
  getDeepSeekReasoningEffort,
  getDeepSeekThinkingPolicy,
  getDeepSeekV4ModelProfile,
  isOfficialDeepSeekApi,
} from "./DeepSeekV4.js";

describe("DeepSeek V4 model profile", () => {
  it("recognizes current Flash and keeps gateway names separate from official IDs", () => {
    expect(getDeepSeekV4ModelProfile("deepseek-flash[1m]")).toMatchObject({
      canonicalModel: "deepseek-flash",
      modelVersion: "DeepSeek-V4.1-Flash",
      officialRequestModel: true,
      vision: true,
      supportsResponses: true,
      parallelToolCalls: true,
    });
    expect(getDeepSeekV4ModelProfile("vendor/deepseek-flash")).toMatchObject({
      officialRequestModel: false,
    });
    expect(
      getDeepSeekV4ModelProfile("deepseek-flash-unreleased"),
    ).toBeUndefined();
  });

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

  it("canonicalizes current Claude Code suffixes and gateway model profiles", () => {
    expect(getDeepSeekV4ModelProfile("deepseek-v4-pro[1m]")).toMatchObject({
      canonicalModel: DEEPSEEK_V4_PRO,
      lane: "pro",
      optimizedThinkingDefault: true,
    });
    expect(
      getDeepSeekV4ModelProfile("deepseek-ai/deepseek-flash"),
    ).toMatchObject({
      lane: "flash",
      modelVersion: "DeepSeek-V4.1-Flash",
      optimizedThinkingDefault: true,
      officialRequestModel: false,
    });
    expect(
      getDeepSeekV4ModelProfile("deepseek-ai/deepseek-v4-pro-0813"),
    ).toMatchObject({
      lane: "pro",
      modelVersion: "DeepSeek-V4-Pro-0813",
      supportsResponses: true,
      reasoningEfforts: ["low", "high", "max"],
      officialRequestModel: false,
    });
  });

  it("normalizes requested effort to the official low/high/max levels", () => {
    expect(getDeepSeekReasoningEffort(1024)).toBe("high");
    expect(getDeepSeekReasoningEffort(4096)).toBe("high");
    expect(getDeepSeekReasoningEffort(8192)).toBe("max");
    expect(getDeepSeekReasoningEffort(8192, "low")).toBe("low");
    expect(getDeepSeekReasoningEffort(8192, "medium")).toBe("high");
    expect(getDeepSeekReasoningEffort(8192, "xhigh")).toBe("high");
  });

  it.each([
    "deepseek-v4-flash",
    "deepseek-v4-flash-vision-exp",
    "deepseek-v4-flash-0731",
    "deepseek-chat",
    "deepseek-reasoner",
  ])("does not resolve retired model %s", (model) => {
    expect(getDeepSeekV4ModelProfile(model)).toBeUndefined();
    expect(getDeepSeekV4ModelProfile(`${model}[1m]`)).toBeUndefined();
  });

  it("uses low for simple Flash work and max for repair", () => {
    const flash = getDeepSeekV4ModelProfile(DEEPSEEK_FLASH)!;
    expect(
      getDeepSeekThinkingPolicy(flash, {
        isComplexTask: false,
        isRepairTurn: false,
      }),
    ).toEqual({ enabled: true, effort: "low", budgetTokens: 2048 });
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
