import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  projectHistoryTokens,
  projectModelInputTokens,
} from "./RequestProjection.js";
import type { OrbitMessage } from "./types.js";

function imageHistory(data: string): OrbitMessage[] {
  return [
    {
      id: "image",
      role: "user",
      createdAt: "now",
      content: [{ type: "image", mediaType: "image/png", data }],
    },
  ];
}

describe("shared request projection", () => {
  it("counts each image occurrence without treating encoded bytes as text or mutating history", () => {
    const small = imageHistory("YQ=="),
      large = imageHistory("A".repeat(1_000_000));
    const before = JSON.stringify(large);
    expect(projectHistoryTokens(small, () => 198)).toBe(
      projectHistoryTokens(large, () => 198),
    );
    expect(
      projectHistoryTokens([...small, ...large], () => 198),
    ).toBeGreaterThan(396);
    expect(JSON.stringify(large)).toBe(before);
    expect(projectHistoryTokens(small, () => NaN)).toBe(
      projectHistoryTokens(small),
    );
  });
  it("includes tool and system context and forwards the selected model to image projection", () => {
    const models: string[] = [];
    const provider = {
      estimateImageTokens: (_image: unknown, model: string) => {
        models.push(model);
        return 198;
      },
    };
    const input = { model: "deepseek-flash", messages: imageHistory("YQ==") };
    const base = projectModelInputTokens(input, provider);
    const withTools = projectModelInputTokens(
      {
        ...input,
        system: "system".repeat(100),
        tools: [
          {
            name: "query",
            description: "Search",
            inputSchema: z.object({ query: z.string() }),
          },
        ],
      },
      provider,
    );
    expect(withTools).toBeGreaterThan(base);
    expect(models).toEqual([input.model, input.model]);
    expect(base).toBeLessThan(4096);
  });
});
