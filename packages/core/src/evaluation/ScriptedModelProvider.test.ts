import { describe, expect, it } from "vitest";
import { z } from "zod";
import type {
  ModelChatInput,
  OrbitToolResult,
} from "@orbit-build/model-providers";
import {
  ScriptedModelProvider,
  ScriptedProviderScenarioSchema,
} from "./ScriptedModelProvider.js";

const input: ModelChatInput = {
  model: "deepseek-v4-flash",
  messages: [
    {
      id: "user-1",
      role: "user" as const,
      createdAt: new Date(0).toISOString(),
      content: [{ type: "text" as const, text: "inspect alpha" }],
    },
  ],
  tools: [
    {
      name: "read_file",
      description: "read",
      inputSchema: z.object({ path: z.string() }),
    },
  ],
};

describe("ScriptedModelProvider", () => {
  it("validates requests, emits deterministic events, and records consumption", async () => {
    const provider = new ScriptedModelProvider({
      schemaVersion: 1,
      id: "deterministic-stream",
      steps: [
        {
          id: "first",
          expect: {
            model: "deepseek-v4-flash",
            messageIncludes: ["alpha"],
            toolNames: ["read_file"],
          },
          actions: [
            {
              type: "tool_call",
              id: "read-alpha",
              name: "read_file",
              arguments: { path: "alpha.txt" },
            },
            {
              type: "usage",
              inputTokens: 10,
              outputTokens: 2,
              cacheReadTokens: 4,
            },
            { type: "done" },
          ],
        },
      ],
    });

    const events = [];
    for await (const event of provider.chat(input)) events.push(event);

    expect(events).toEqual([
      {
        type: "tool_call",
        toolCall: {
          id: "read-alpha",
          name: "read_file",
          arguments: '{"path":"alpha.txt"}',
        },
      },
      {
        type: "usage",
        usage: {
          inputTokens: 10,
          outputTokens: 2,
          totalTokens: 12,
          cacheReadTokens: 4,
        },
      },
      { type: "done" },
    ]);
    expect(provider.requests).toEqual([
      {
        stepId: "first",
        model: "deepseek-v4-flash",
        messageCount: 1,
        toolNames: ["read_file"],
      },
    ]);
    expect(() => provider.assertExhausted()).not.toThrow();
  });

  it("fails closed on a request-contract mismatch", async () => {
    const provider = new ScriptedModelProvider({
      schemaVersion: 1,
      id: "mismatch",
      steps: [
        {
          id: "strict-model",
          expect: { model: "deepseek-v4-pro" },
          actions: [{ type: "done" }],
        },
      ],
    });

    await expect(collect(provider.chat(input))).rejects.toMatchObject({
      code: "request_contract_failed",
    });
    expect(provider.requests).toEqual([]);
    expect(() => provider.assertExhausted()).toThrow("strict-model");
  });

  it("validates actual tool results independently of user and assistant text", async () => {
    const provider = toolResultProvider();

    await expect(collect(provider.chat(input))).rejects.toMatchObject({
      code: "request_contract_failed",
    });
    await expect(
      collect(provider.chat(withToolResults([successfulRead]))),
    ).resolves.toEqual([{ type: "done" }]);
    expect(() => provider.assertExhausted()).not.toThrow();
  });

  it.each([
    [{ ...successfulRead, name: "other_tool" }],
    [{ ...successfulRead, toolCallId: "wrong-id" }],
    [{ ...successfulRead, isError: true }],
    [{ ...successfulRead, content: "no matching content" }],
    [successfulRead, successfulRead],
  ])(
    "rejects mismatched or duplicate tool-result evidence: %j",
    async (...results) => {
      const provider = toolResultProvider();

      await expect(
        collect(provider.chat(withToolResults(results))),
      ).rejects.toMatchObject({ code: "request_contract_failed" });
    },
  );

  it("rejects requests beyond the declared scenario", async () => {
    const provider = toolResultProvider();
    await collect(provider.chat(withToolResults([successfulRead])));

    await expect(collect(provider.chat(input))).rejects.toMatchObject({
      code: "scenario_exhausted",
    });
  });

  it("can reproduce a provider that emits a late event after cancellation", async () => {
    const provider = new ScriptedModelProvider({
      schemaVersion: 1,
      id: "late-event",
      steps: [
        {
          id: "wait",
          actions: [
            { type: "wait", gate: "upstream", honorAbort: false },
            { type: "text_delta", text: "late" },
            { type: "done" },
          ],
        },
      ],
    });
    const controller = new AbortController();
    const collecting = collect(
      provider.chat({ ...input, abortSignal: controller.signal }),
    );
    await waitUntil(() => provider.controller.isWaiting("upstream"));
    controller.abort();
    provider.controller.release("upstream");

    await expect(collecting).resolves.toEqual([
      { type: "text_delta", text: "late" },
      { type: "done" },
    ]);
  });

  it("can model an abort-aware upstream wait without leaking a gate waiter", async () => {
    const provider = new ScriptedModelProvider({
      schemaVersion: 1,
      id: "abort-aware-wait",
      steps: [
        {
          id: "wait",
          actions: [{ type: "wait", gate: "upstream" }, { type: "done" }],
        },
      ],
    });
    const controller = new AbortController();
    const collecting = collect(
      provider.chat({ ...input, abortSignal: controller.signal }),
    );
    await waitUntil(() => provider.controller.isWaiting("upstream"));

    controller.abort();

    await expect(collecting).rejects.toMatchObject({ name: "AbortError" });
    expect(provider.controller.isWaiting("upstream")).toBe(false);
  });

  it("emits explicit provider error events with structured retry metadata", async () => {
    const provider = new ScriptedModelProvider({
      schemaVersion: 1,
      id: "error-event",
      steps: [
        {
          id: "stream-error",
          actions: [
            {
              type: "error_event",
              message: "stream disconnected",
              code: "disconnect",
              retryable: true,
            },
          ],
        },
      ],
    });

    const [event] = await collect(provider.chat(input));

    expect(event).toMatchObject({
      type: "error",
      error: {
        name: "ScriptedProviderFault",
        code: "disconnect",
        retryable: true,
      },
    });
  });

  it("fails replay verification when declared steps remain unused", () => {
    const provider = new ScriptedModelProvider({
      schemaVersion: 1,
      id: "incomplete",
      steps: [{ id: "unused", actions: [{ type: "done" }] }],
    });

    expect(() => provider.assertExhausted()).toThrow("unused");
  });

  it("rejects duplicate step identifiers at the external boundary", () => {
    expect(() =>
      ScriptedProviderScenarioSchema.parse({
        schemaVersion: 1,
        id: "duplicates",
        steps: [
          { id: "same", actions: [{ type: "done" }] },
          { id: "same", actions: [{ type: "done" }] },
        ],
      }),
    ).toThrow("Duplicate scripted provider step id");
  });

  it("rejects unknown scenario fields instead of ignoring contract typos", () => {
    expect(() =>
      ScriptedProviderScenarioSchema.parse({
        schemaVersion: 1,
        id: "strict-boundary",
        steps: [
          {
            id: "typo",
            actions: [{ type: "done", unexpected: true }],
          },
        ],
      }),
    ).toThrow("Unrecognized key");
  });
});

const successfulRead: OrbitToolResult = {
  toolCallId: "read-alpha",
  name: "read_file",
  content: "alpha",
  isError: false,
};

function toolResultProvider(): ScriptedModelProvider {
  return new ScriptedModelProvider({
    schemaVersion: 1,
    id: "tool-evidence",
    steps: [
      {
        id: "verify-result",
        expect: {
          toolResults: [
            {
              toolCallId: successfulRead.toolCallId,
              name: successfulRead.name,
              isError: false,
              contentIncludes: ["alpha"],
            },
          ],
        },
        actions: [{ type: "done" }],
      },
    ],
  });
}

function withToolResults(results: OrbitToolResult[]): ModelChatInput {
  return {
    ...input,
    messages: [
      ...input.messages,
      {
        id: "tool-results",
        role: "tool",
        createdAt: new Date(0).toISOString(),
        content: results.map((toolResult) => ({
          type: "tool_result",
          toolResult,
        })),
      },
    ],
  };
}

async function collect(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const values: unknown[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("Timed out waiting for scripted provider gate.");
}
