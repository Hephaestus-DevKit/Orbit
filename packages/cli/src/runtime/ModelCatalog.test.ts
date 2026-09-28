import { describe, expect, it } from "vitest";
import {
  describeDeprecatedDeepSeekAliases,
  formatModelOptionLabel,
  getDeepSeekAliasMigration,
  getDeepSeekAliasReplacement,
  getProviderModelCandidates,
  inferProviderCatalogKind,
  isDeprecatedDeepSeekAlias,
} from "./ModelCatalog.js";

describe("ModelCatalog", () => {
  it("retains current Flash from the official discovered catalog", () => {
    expect(
      getProviderModelCandidates({
        provider: { default: "deepseek" },
        providers: {
          deepseek: {
            type: "deepseek",
            models: ["deepseek-flash", "deepseek-v4-pro"],
          },
        },
      }),
    ).toEqual(["deepseek-flash", "deepseek-v4-pro"]);
  });

  it("should prefer configured provider models", () => {
    const models = getProviderModelCandidates({
      provider: { default: "ciyuan" },
      providers: {
        ciyuan: {
          type: "openai-compatible",
          models: ["vendor/fast", "vendor/reasoner"],
        },
      },
    });

    expect(models).toEqual(["vendor/fast", "vendor/reasoner"]);
  });

  it.each([
    ["deepseek-v4-flash", "deepseek-v4-flash-vision-exp"],
    ["deepseek-chat", "deepseek-reasoner", "deepseek-v4-flash-0731"],
    ["deepseek-flash", "deepseek-v4-pro", "deepseek-v4-flash"],
  ])(
    "does not expose retired names from a stale official catalog: %j",
    (...models) => {
      expect(
        getProviderModelCandidates({
          provider: { default: "deepseek" },
          providers: { deepseek: { type: "deepseek", models } },
        }),
      ).toEqual(["deepseek-flash", "deepseek-v4-pro"]);
    },
  );

  it.each([
    "deepseek-v4-flash",
    "deepseek-v4-flash-vision-exp",
    "DeepSeek-V4-Flash-0731",
  ])("retains migration guidance, not execution support, for %s", (model) => {
    expect(getDeepSeekAliasMigration(model)).toEqual({
      model: "deepseek-flash",
      thinking: "high",
    });
  });

  it("hides only models explicitly classified as incompatible with chat", () => {
    const models = getProviderModelCandidates({
      provider: { default: "gateway" },
      providers: {
        gateway: {
          type: "openai-compatible",
          models: ["chat-a", "unknown-a", "embed-a", "video-a"],
          modelCapabilities: {
            "chat-a": { kind: "chat" },
            "embed-a": { kind: "embedding" },
            "video-a": { kind: "video" },
          },
        },
      },
    });

    expect(models).toEqual(["chat-a", "unknown-a"]);
  });

  it("uses a narrow TokenDance fallback when its catalog exposes IDs only", () => {
    const models = getProviderModelCandidates({
      provider: { default: "tokendance" },
      providers: {
        tokendance: {
          type: "openai-compatible",
          models: [
            "deepseek-v4-pro",
            "qwen-text-embedding-v4",
            "happyhorse-1.0-r2v",
            "seedance-1.5-pro",
            "seedream-4.0",
            "bocha-web-search",
            "unifuncs-web-reader",
            "kling-3.0",
            "speech-2.6-hd",
            "unknown-future-chat-model",
          ],
        },
      },
    });

    expect(models).toEqual(["deepseek-v4-pro", "unknown-future-chat-model"]);
    expect(
      inferProviderCatalogKind("another-gateway", "text-embedding-3"),
    ).toBe(undefined);
    expect(formatModelOptionLabel("step-3.7-flash")).toBe("step-3.7-flash");
    expect(formatModelOptionLabel("seed-2.1-pro")).toBe("seed-2.1-pro");
  });

  it("should provide current default OpenAI and Anthropic candidates", () => {
    expect(
      getProviderModelCandidates({
        provider: { default: "openai" },
        providers: { openai: { type: "openai" } },
      }),
    ).toContain("gpt-5.5");
    expect(
      getProviderModelCandidates({
        provider: { default: "anthropic" },
        providers: { anthropic: { type: "anthropic" } },
      }),
    ).toContain("claude-sonnet-4-6");
  });

  it("only exposes official DeepSeek V4 candidates by default", () => {
    const models = getProviderModelCandidates({
      provider: { default: "deepseek-openai" },
      providers: { "deepseek-openai": { type: "openai-compatible" } },
    });

    expect(models).toEqual(["deepseek-flash", "deepseek-v4-pro"]);
  });

  it("collapses dated DeepSeek builds into stable official model IDs", () => {
    expect(
      getProviderModelCandidates({
        provider: { default: "deepseek" },
        providers: {
          deepseek: {
            type: "openai-compatible",
            baseUrl: "https://api.deepseek.com",
            models: [
              "deepseek-flash",
              "DeepSeek-V4-Pro-0813",
              "unrelated-provider-model",
            ],
          },
        },
      }),
    ).toEqual(["deepseek-flash", "deepseek-v4-pro"]);
    expect(formatModelOptionLabel("deepseek-flash")).toBe("deepseek-flash");
    expect(formatModelOptionLabel("deepseek-v4-pro")).toBe("deepseek-v4-pro");
  });

  it("does not constrain third-party gateways that merely use a DeepSeek-like id", () => {
    expect(
      getProviderModelCandidates({
        provider: { default: "deepseek-gateway" },
        providers: {
          "deepseek-gateway": {
            type: "openai-compatible",
            baseUrl: "https://gateway.example.test/v1",
            models: ["vendor-fast", "vendor-pro"],
          },
        },
      }),
    ).toEqual(["vendor-fast", "vendor-pro"]);
  });

  it("describes DeepSeek legacy aliases with V4 replacements", () => {
    expect(isDeprecatedDeepSeekAlias("deepseek-chat")).toBe(true);
    expect(getDeepSeekAliasReplacement("deepseek-reasoner")).toBe(
      "deepseek-flash",
    );
    expect(getDeepSeekAliasMigration("deepseek-reasoner")).toEqual({
      model: "deepseek-flash",
      thinking: "high",
    });
    expect(formatModelOptionLabel("deepseek-chat")).toContain(
      "deprecated -> deepseek-flash",
    );
    expect(
      describeDeprecatedDeepSeekAliases([
        "deepseek-chat",
        "deepseek-reasoner",
        "deepseek-flash",
      ]),
    ).toContain("deepseek-reasoner -> deepseek-flash (thinking high)");
  });
});
