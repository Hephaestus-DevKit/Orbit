import { describe, expect, it } from "vitest";
import { canonicalJsonStringify, canonicalizeJson } from "./canonicalJson.js";

describe("canonical JSON", () => {
  it("sorts nested object keys without reordering arrays", () => {
    expect(
      canonicalJsonStringify({
        z: 1,
        nested: { required: ["z", "a"], a: true },
        a: 2,
      }),
    ).toBe('{"a":2,"nested":{"a":true,"required":["z","a"]},"z":1}');
  });

  it("matches JSON omission and array-null behavior", () => {
    expect(
      canonicalizeJson({
        omitted: undefined,
        values: [1, undefined, 3],
      }),
    ).toEqual({ values: [1, null, 3] });
  });

  it("rejects cycles and non-finite numbers", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalizeJson(cyclic)).toThrow(/cyclic/);
    expect(() => canonicalizeJson(Number.NaN)).toThrow(/non-finite/);
  });
});
