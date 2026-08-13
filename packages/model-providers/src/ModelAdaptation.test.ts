import { describe, expect, it } from "vitest";
import {
  resolveDeepSeekModelProfile,
  resolveModelAdaptation,
  resolveModelCanonicalName,
  resolveModelThinkingPolicy,
} from "./ModelAdaptation.js";

describe("model adaptation resolver", () => {
  it("selects DeepSeek semantics by model identity, not provider host", () => {
    expect(resolveModelAdaptation("deepseek-v4-flash")).toMatchObject({
      family: "deepseek-v4",
      deepSeekV4: {
        canonicalModel: "deepseek-v4-flash",
        modelVersion: "DeepSeek-V4-Flash-0731",
      },
    });
    expect(
      resolveModelAdaptation("deepseek-ai/deepseek-v4-flash-0731"),
    ).toMatchObject({
      family: "deepseek-v4",
      requestedModel: "deepseek-ai/deepseek-v4-flash-0731",
    });
  });

  it("leaves all other models on the generic compatible path", () => {
    expect(resolveModelAdaptation("vendor/general-model")).toEqual({
      family: "generic",
      requestedModel: "vendor/general-model",
    });
    expect(resolveDeepSeekModelProfile("vendor/general-model")).toBeUndefined();
    expect(
      resolveDeepSeekModelProfile("gateway/deepseek-v4-pro-0813"),
    ).toMatchObject({ canonicalModel: "deepseek-v4-pro" });
  });

  it("keeps the generic policy independent from provider transport", () => {
    expect(
      resolveModelThinkingPolicy("vendor/general-model", {
        isComplexTask: false,
        isRepairTurn: false,
      }),
    ).toBeUndefined();
    expect(
      resolveModelThinkingPolicy("vendor/general-model", {
        isComplexTask: true,
        isRepairTurn: false,
      }),
    ).toEqual({ enabled: true, budgetTokens: 4096 });
    expect(
      resolveModelThinkingPolicy("vendor/general-model", {
        isComplexTask: false,
        isRepairTurn: true,
      }),
    ).toEqual({ enabled: true, budgetTokens: 8192 });
  });

  it("applies DeepSeek family policy and canonical identity through aliases", () => {
    expect(
      resolveModelThinkingPolicy("deepseek-ai/deepseek-v4-flash-0731", {
        isComplexTask: false,
        isRepairTurn: false,
      }),
    ).toMatchObject({ enabled: true, effort: "low", budgetTokens: 2048 });
    expect(
      resolveModelThinkingPolicy("deepseek-v4-flash", {
        isComplexTask: true,
        isRepairTurn: false,
      }),
    ).toMatchObject({ enabled: true, effort: "high", budgetTokens: 4096 });
    expect(
      resolveModelThinkingPolicy("deepseek-v4-flash", {
        isComplexTask: false,
        isRepairTurn: true,
      }),
    ).toMatchObject({ enabled: true, effort: "max", budgetTokens: 8192 });
    expect(
      resolveModelCanonicalName("deepseek-ai/deepseek-v4-flash-0731"),
    ).toBe("deepseek-v4-flash");
    expect(resolveModelCanonicalName("deepseek-ai/deepseek-v4-pro-0813")).toBe(
      "deepseek-v4-pro",
    );
    expect(resolveModelCanonicalName("vendor/general-model")).toBe(
      "vendor/general-model",
    );
  });
});
