import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@orbit-build/config";
import type { ModelProvider, OrbitMessage } from "@orbit-build/model-providers";
import {
  buildSemanticCompactionSummary,
  compactHistoryMessages,
  resolveContextWindowStatus,
} from "./ContextWindowManager.js";

function message(
  role: OrbitMessage["role"],
  text: string,
  index: number,
): OrbitMessage {
  return {
    id: `msg_${role}_${index}`,
    role,
    createdAt: new Date(2026, 0, 1, 0, index).toISOString(),
    content: [{ type: "text", text }],
  };
}

function longHistory(): OrbitMessage[] {
  const filler = "The quick brown fox jumps over the lazy dog. ".repeat(30);
  return Array.from({ length: 12 }, (_, index) =>
    message(
      index % 2 === 0 ? "user" : "assistant",
      `Turn ${index}: ${filler}`,
      index,
    ),
  );
}

function stubProvider(
  events: Array<{ type: string; text?: string }>,
): ModelProvider {
  return {
    chat: async function* () {
      for (const event of events) yield event;
    },
  } as unknown as ModelProvider;
}

describe("compactHistoryMessages", () => {
  it("exposes dropped turns and the summary message id for refinement", () => {
    const result = compactHistoryMessages(longHistory(), {
      mode: "automatic",
      compactAtTokens: 400,
    });

    expect(result.droppedMessages).toBeGreaterThan(0);
    expect(result.droppedHistory).toHaveLength(result.droppedMessages);
    expect(result.summaryMessageId).toBeTruthy();
    const summary = result.history.find(
      (candidate) => candidate.id === result.summaryMessageId,
    );
    expect(summary?.metadata?.kind).toBe("history_compaction_summary");
  });

  it("omits dropped-history fields when nothing is dropped", () => {
    const result = compactHistoryMessages(
      [message("user", "short", 0), message("assistant", "reply", 1)],
      { mode: "automatic", compactAtTokens: 100_000 },
    );

    expect(result.droppedMessages).toBe(0);
    expect(result.droppedHistory).toBeUndefined();
    expect(result.summaryMessageId).toBeUndefined();
  });
});

describe("resolveContextWindowStatus", () => {
  it("adapts budgets independently for each discovered provider model", () => {
    const provider = {
      getModelCapabilities: (model: string) =>
        model === "tokendance/large"
          ? {
              maxContextTokens: 256_000,
              maxOutputTokens: 64_000,
              effectiveContextWindowPercent: 0.9,
            }
          : { maxContextTokens: 64_000, maxOutputTokens: 8_000 },
    } as unknown as ModelProvider;
    const config = structuredClone(DEFAULT_CONFIG);
    config.models.fast = "tokendance/small";
    config.agent.fastMaxOutputTokens = 12_000;
    config.agent.maxOutputTokens = 48_000;

    const large = resolveContextWindowStatus({
      model: "tokendance/large",
      config,
      provider,
      history: [],
    });
    const small = resolveContextWindowStatus({
      model: "tokendance/small",
      config,
      provider,
      history: [],
    });

    expect(large).toMatchObject({
      advertisedContextTokens: 256_000,
      maxContextTokens: 230_400,
      reservedOutputTokens: 48_000,
      capabilitySource: "provider",
    });
    expect(small).toMatchObject({
      advertisedContextTokens: 64_000,
      maxContextTokens: 64_000,
      reservedOutputTokens: 8_000,
      capabilitySource: "provider",
    });
  });

  it("uses a conservative budget when a future model exposes no limits", () => {
    const status = resolveContextWindowStatus({
      model: "future-provider/unknown-model",
      config: structuredClone(DEFAULT_CONFIG),
      provider: {} as ModelProvider,
      history: [],
    });

    expect(status).toMatchObject({
      advertisedContextTokens: 128_000,
      maxContextTokens: 128_000,
      capabilitySource: "safe-default",
    });
  });
});

describe("buildSemanticCompactionSummary", () => {
  const dropped = longHistory().slice(0, 8);

  it("returns a fast-model summary with the standard header and caution", async () => {
    const provider = stubProvider([
      { type: "text_delta", text: "User asked for X. " },
      { type: "text_delta", text: "Files a.ts and b.ts were modified." },
    ]);

    const summary = await buildSemanticCompactionSummary(
      dropped,
      provider,
      "fast-model",
    );

    expect(summary).toContain("[Conversation Summary]");
    expect(summary).toContain("Files a.ts and b.ts were modified.");
    expect(summary).toContain("Rely on recent turns");
  });

  it("returns null when the stream yields an error event", async () => {
    const provider = stubProvider([
      { type: "text_delta", text: "partial" },
      { type: "error" },
    ]);

    expect(
      await buildSemanticCompactionSummary(dropped, provider, "fast-model"),
    ).toBeNull();
  });

  it("returns null when the model produces no text", async () => {
    const provider = stubProvider([]);

    expect(
      await buildSemanticCompactionSummary(dropped, provider, "fast-model"),
    ).toBeNull();
  });

  it("returns null when the provider throws", async () => {
    const provider = {
      chat: () => {
        throw new Error("network down");
      },
    } as unknown as ModelProvider;

    expect(
      await buildSemanticCompactionSummary(dropped, provider, "fast-model"),
    ).toBeNull();
  });

  it("skips the model call for trivially small digests", async () => {
    let called = false;
    const provider = {
      chat: async function* () {
        called = true;
        yield { type: "text_delta", text: "should not run" };
      },
    } as unknown as ModelProvider;

    const summary = await buildSemanticCompactionSummary(
      [message("user", "tiny", 0)],
      provider,
      "fast-model",
    );

    expect(summary).toBeNull();
    expect(called).toBe(false);
  });

  it("returns null without a configured fast model", async () => {
    expect(
      await buildSemanticCompactionSummary(dropped, stubProvider([]), ""),
    ).toBeNull();
  });
});
