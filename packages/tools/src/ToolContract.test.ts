import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { OrbitTool } from "./types.js";
import {
  isParallelTool,
  resolveToolExecutionContract,
  validateToolResult,
} from "./ToolContract.js";

function tool(
  execution?: OrbitTool<unknown, string>["execution"],
): OrbitTool<unknown, string> {
  return {
    name: "fixture",
    description: "fixture tool",
    risk: "read",
    inputSchema: z.unknown(),
    execution,
    execute: async () => ({ ok: true, data: "ok" }),
  };
}

describe("ToolContract v2", () => {
  it("keeps legacy tools exclusive by default", () => {
    const contract = resolveToolExecutionContract(tool());

    expect(contract).toMatchObject({
      version: 2,
      readOnly: false,
      idempotent: false,
      concurrency: "exclusive",
    });
    expect(isParallelTool(tool())).toBe(false);
  });

  it("requires every parallel capability to be explicit", () => {
    const parallel = tool({
      version: 2,
      readOnly: true,
      idempotent: true,
      concurrency: "parallel",
      cancellation: "cooperative",
      outputSchema: z.string(),
    });

    expect(isParallelTool(parallel)).toBe(true);
  });

  it("rejects successful data that violates the output schema", () => {
    const contracted = tool({
      version: 2,
      readOnly: true,
      idempotent: true,
      concurrency: "parallel",
      cancellation: "boundary",
      outputSchema: z.string(),
    });

    expect(
      validateToolResult(contracted, { ok: true, data: 42 }),
    ).toMatchObject({
      ok: false,
      failure: { code: "invalid_output", retryable: false },
    });
  });

  it("normalizes unstructured failures without hiding their message", () => {
    expect(
      validateToolResult(tool(), { ok: false, error: "service unavailable" }),
    ).toEqual({
      ok: false,
      error: "service unavailable",
      failure: {
        code: "execution_error",
        message: "service unavailable",
        retryable: false,
      },
    });
  });

  it.each([
    null,
    [],
    {},
    { ok: "false" },
    { ok: false, error: 42 },
    { ok: true, display: {} },
    { ok: true, metadata: [] },
    { ok: false, failure: "unavailable" },
    { ok: false, failure: { code: "timeout", message: "slow" } },
    {
      ok: false,
      failure: { code: "timeout", message: "slow", retryable: "yes" },
    },
  ])("rejects malformed result envelopes without throwing: %j", (value) => {
    expect(validateToolResult(tool(), value)).toMatchObject({
      ok: false,
      failure: { code: "invalid_output", retryable: false },
    });
  });

  it("preserves structured failures and supplies their human-readable error", () => {
    const failure = {
      code: "vendor_rate_limit",
      message: "Retry after the cooldown.",
      retryable: true,
      details: { retryAfterMs: 1000 },
    };

    expect(validateToolResult(tool(), { ok: false, failure })).toEqual({
      ok: false,
      error: failure.message,
      failure,
    });
  });

  it("keeps legacy data and metadata intact without requiring an output schema", () => {
    const result = {
      ok: true,
      data: { content: "hello" },
      display: "Read one file",
      metadata: { bytes: 5 },
    };

    expect(validateToolResult(tool(), result)).toEqual(result);
    expect(validateToolResult(tool(), { ok: false, error: " " })).toMatchObject(
      {
        error: 'Tool "fixture" failed.',
      },
    );
  });

  it("contains throwing output refinements at the tool boundary", () => {
    const contracted = tool({
      version: 2,
      readOnly: true,
      idempotent: true,
      concurrency: "parallel",
      cancellation: "boundary",
      outputSchema: z.string().refine(() => {
        throw new Error("Private validator implementation detail");
      }),
    });

    const result = validateToolResult(contracted, { ok: true, data: "value" });

    expect(result).toMatchObject({
      ok: false,
      failure: { code: "invalid_output", retryable: false },
    });
    expect(result.error).not.toContain(
      "Private validator implementation detail",
    );
  });
});
