import { describe, expect, it } from "vitest";
import { Planner } from "./Planner.js";

describe("Planner system prompt", () => {
  it("adds a sanitized durable session goal to the system prompt", () => {
    const prompt = Planner.makeSystemPrompt(
      "deepseek-v4-pro",
      "en",
      "tokendance",
      " Ship the release\nwithout regressions ",
    );

    expect(prompt).toContain("Active Session Goal:");
    expect(prompt).toContain("Ship the release without regressions");
  });

  it("includes explicit project memory and the recoverable task plan", () => {
    const prompt = Planner.makeSystemPrompt(
      "deepseek-v4-pro",
      "en",
      "deepseek",
      undefined,
      ["Use pnpm for this project"],
      ["[in_progress] Verify release"],
    );

    expect(prompt).toContain("Explicit Project Memory (user-managed)");
    expect(prompt).toContain("Use pnpm for this project");
    expect(prompt).toContain("Active Task Plan");
    expect(prompt).toContain("[in_progress] Verify release");
  });

  it("pins Simplified Chinese replies when configured for zh", () => {
    const prompt = Planner.makeSystemPrompt("deepseek-v4-pro", "zh");

    expect(prompt).toContain("Reply in Simplified Chinese by default");
    expect(prompt).toContain("DeepSeek");
    expect(prompt).toContain("Use the runtime date from the Volatile Context");
    expect(prompt).toContain(
      "If all live lookups fail or report low confidence",
    );
    expect(prompt).toContain(
      "Preserve source URLs for verified time-sensitive claims",
    );
    expect(prompt).toContain(
      "search the live web instead of relying on model training memory",
    );
  });

  it("matches the user's message language when configured for en", () => {
    const prompt = Planner.makeSystemPrompt("deepseek-v4-flash", "en");

    expect(prompt).toContain("Reply in the user's language");
  });

  it("pins the current provider and model over historical assistant claims", () => {
    const prompt = Planner.makeSystemPrompt("qwen2.5-coder:7b", "zh", "ollama");

    expect(prompt).toContain("powered by Ollama");
    expect(prompt).toContain("active provider is Ollama (id: ollama)");
    expect(prompt).toContain("active model is qwen2.5-coder:7b");
    expect(prompt).toContain("previously selected provider or model");
    expect(prompt).not.toContain("powered by DeepSeek");
  });

  it("keeps DeepSeek as the explicit profile on a compatible gateway", () => {
    const prompt = Planner.makeSystemPrompt(
      "deepseek-v4-pro",
      "zh",
      "tokendance",
    );

    expect(prompt).toContain("DeepSeek via TokenDance");
  });

  it("uses declared reasoning capability instead of model-name guessing", () => {
    const capable = Planner.makeSystemPrompt(
      "opaque-model-id",
      "en",
      "custom",
      undefined,
      undefined,
      undefined,
      true,
    );
    const nameOnly = Planner.makeSystemPrompt("looks-like-r1", "en", "custom");

    expect(capable).toContain("Since you are a reasoning model");
    expect(nameOnly).not.toContain("Since you are a reasoning model");
  });
});
