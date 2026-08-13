import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  canonicalizeToolDefinitions,
  toolDefinitionsFingerprint,
  validateDeepSeekUserId,
} from "./CanonicalRequest.js";

const alpha = {
  name: "alpha",
  description: "Alpha tool",
  inputSchema: z.object({ z: z.string(), a: z.number() }),
};
const beta = {
  name: "beta",
  description: "Beta tool",
  inputSchema: z.object({ value: z.string() }),
};

describe("request canonicalization", () => {
  it("sorts tools and recursively canonicalizes materialized schemas", () => {
    const tools = canonicalizeToolDefinitions([beta, alpha]);
    expect(tools?.map((tool) => tool.name)).toEqual(["alpha", "beta"]);
    expect(
      Object.keys(tools?.[0].inputJsonSchema.properties as object),
    ).toEqual(["a", "z"]);
  });

  it("produces the same fingerprint for equivalent registration order", () => {
    expect(toolDefinitionsFingerprint([alpha, beta])).toBe(
      toolDefinitionsFingerprint([beta, alpha]),
    );
  });

  it("normalizes semantically unordered JSON Schema required fields", () => {
    const first = {
      ...alpha,
      inputJsonSchema: {
        type: "object",
        properties: { a: { type: "string" }, z: { type: "number" } },
        required: ["z", "a"],
      },
    };
    const second = {
      ...alpha,
      inputJsonSchema: {
        required: ["a", "z"],
        properties: { z: { type: "number" }, a: { type: "string" } },
        type: "object",
      },
    };
    expect(toolDefinitionsFingerprint([first])).toBe(
      toolDefinitionsFingerprint([second]),
    );
  });

  it("rejects duplicate or invalid tool identities", () => {
    expect(() => canonicalizeToolDefinitions([alpha, alpha])).toThrow(
      /Duplicate provider tool name/,
    );
    expect(() =>
      canonicalizeToolDefinitions([{ ...alpha, name: "bad tool" }]),
    ).toThrow(/Invalid provider tool name/);
  });

  it("validates DeepSeek user cache-isolation identifiers", () => {
    expect(() => validateDeepSeekUserId("workspace-stable")).not.toThrow();
    expect(() => validateDeepSeekUserId("")).toThrow(/user_id/);
    expect(() => validateDeepSeekUserId("x".repeat(513))).toThrow(/user_id/);
  });
});
