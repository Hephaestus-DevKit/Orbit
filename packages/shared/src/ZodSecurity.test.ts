import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

describe("bounded external collection parsing", () => {
  it("rejects oversized arrays, sets, and maps before parsing their elements", () => {
    const visited = vi.fn(() => true);
    const item = z.unknown().refine(visited);
    const inputs = Array.from({ length: 1000 }, (_, i) => i);
    expect(z.array(item).max(10).safeParse(inputs).success).toBe(false);
    expect(z.set(item).max(10).safeParse(new Set(inputs)).success).toBe(false);
    expect(
      z
        .map(item, item)
        .max(10)
        .safeParse(new Map(inputs.map((i) => [i, i]))).success,
    ).toBe(false);
    expect(visited).not.toHaveBeenCalled();
  });
});
