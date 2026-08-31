import { z } from "zod";
import type {
  ModelChatInput,
  ModelEvent,
  ModelProvider,
} from "@orbit-build/model-providers";

const ScriptedProviderTypeSchema = z.enum([
  "openai",
  "anthropic",
  "openai-compatible",
  "anthropic-compatible",
  "deepseek",
  "ollama",
]);

const ScriptedFaultFields = {
  message: z.string().trim().min(1).max(20_000),
  status: z.number().int().min(100).max(599).optional(),
  code: z.string().trim().min(1).max(120).optional(),
  retryable: z.boolean().default(false),
};

const ScriptedActionSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("text_delta"), text: z.string().max(200_000) })
    .strict(),
  z
    .object({
      type: z.literal("thinking_delta"),
      text: z.string().max(200_000),
      signature: z.string().max(20_000).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool_call"),
      id: z.string().trim().min(1).max(200),
      name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
      arguments: z.union([z.string().max(1_000_000), z.record(z.unknown())]),
    })
    .strict(),
  z
    .object({
      type: z.literal("usage"),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      cacheReadTokens: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z.object({ type: z.literal("done") }).strict(),
  z
    .object({
      type: z.literal("wait"),
      gate: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
      honorAbort: z.boolean().default(true),
    })
    .strict(),
  z.object({ type: z.literal("throw"), ...ScriptedFaultFields }).strict(),
  z.object({ type: z.literal("error_event"), ...ScriptedFaultFields }).strict(),
]);

const ScriptedStepSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    expect: z
      .object({
        model: z.string().trim().min(1).max(300).optional(),
        messageIncludes: z
          .array(z.string().min(1).max(20_000))
          .max(32)
          .default([]),
        toolNames: z
          .array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/))
          .max(128)
          .default([]),
        toolResults: z
          .array(
            z
              .object({
                toolCallId: z.string().trim().min(1).max(200),
                name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
                isError: z.boolean(),
                contentIncludes: z
                  .array(z.string().min(1).max(20_000))
                  .max(32)
                  .default([]),
              })
              .strict(),
          )
          .max(128)
          .default([]),
      })
      .strict()
      .default({}),
    actions: z.array(ScriptedActionSchema).min(1).max(256),
  })
  .strict();

export const ScriptedProviderScenarioSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    provider: z
      .object({
        id: z.string().trim().min(1).max(120).default("scripted-provider"),
        type: ScriptedProviderTypeSchema.default("openai-compatible"),
      })
      .strict()
      .default({}),
    steps: z
      .array(ScriptedStepSchema)
      .min(1)
      .max(256)
      .superRefine((steps, context) => {
        const seen = new Set<string>();
        steps.forEach((step, index) => {
          if (seen.has(step.id)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: [index, "id"],
              message: `Duplicate scripted provider step id: ${step.id}`,
            });
          }
          seen.add(step.id);
        });
      }),
  })
  .strict();

export type ScriptedProviderScenario = z.infer<
  typeof ScriptedProviderScenarioSchema
>;
type ScriptedAction = z.infer<typeof ScriptedActionSchema>;

export interface ScriptedProviderRequestRecord {
  stepId: string;
  model: string;
  messageCount: number;
  toolNames: string[];
}

export class ScriptedProviderFault extends Error {
  public readonly name = "ScriptedProviderFault";

  public constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
    public readonly retryable = false,
  ) {
    super(message);
  }
}

/** Deterministic synchronization points for cancellation and race scenarios. */
export class ScriptedProviderController {
  private readonly released = new Set<string>();
  private readonly waiters = new Map<string, Set<() => void>>();

  public release(gate: string): void {
    this.released.add(gate);
    const waiters = this.waiters.get(gate);
    if (!waiters) return;
    this.waiters.delete(gate);
    for (const resolve of waiters) resolve();
  }

  public isWaiting(gate: string): boolean {
    return (this.waiters.get(gate)?.size ?? 0) > 0;
  }

  public async wait(
    gate: string,
    signal: AbortSignal | undefined,
    honorAbort: boolean,
  ): Promise<void> {
    if (this.released.has(gate)) return;
    if (honorAbort && signal?.aborted) throw abortError(gate);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        this.deleteWaiter(gate, finish);
        resolve();
      };
      const onAbort = (): void => {
        if (!honorAbort || settled) return;
        settled = true;
        this.deleteWaiter(gate, finish);
        reject(abortError(gate));
      };
      const waiters = this.waiters.get(gate) ?? new Set<() => void>();
      waiters.add(finish);
      this.waiters.set(gate, waiters);
      if (honorAbort)
        signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private deleteWaiter(gate: string, waiter: () => void): void {
    const waiters = this.waiters.get(gate);
    waiters?.delete(waiter);
    if (waiters?.size === 0) this.waiters.delete(gate);
  }
}

/**
 * Schema-validated, replayable provider for offline Agent acceptance tests.
 * Constructors only validate and initialize state; no timers or I/O start.
 */
export class ScriptedModelProvider implements ModelProvider {
  public readonly id: string;
  public readonly type: ModelProvider["type"];
  public readonly capabilities = {
    streaming: true,
    toolCalls: true,
    jsonMode: true,
    thinking: true,
    vision: false,
    promptCaching: true,
  };
  public readonly requests: ScriptedProviderRequestRecord[] = [];
  private readonly scenario: ScriptedProviderScenario;
  private cursor = 0;

  public constructor(
    scenario: unknown,
    public readonly controller = new ScriptedProviderController(),
  ) {
    this.scenario = ScriptedProviderScenarioSchema.parse(scenario);
    this.id = this.scenario.provider.id;
    this.type = this.scenario.provider.type;
  }

  public async *chat(input: ModelChatInput): AsyncIterable<ModelEvent> {
    const step = this.scenario.steps[this.cursor];
    if (!step) {
      throw new ScriptedProviderFault(
        `Scripted provider scenario "${this.scenario.id}" received unexpected request ${this.cursor + 1}; every step was already consumed.`,
        undefined,
        "scenario_exhausted",
      );
    }
    assertRequest(step.id, step.expect, input);
    this.cursor += 1;
    this.requests.push({
      stepId: step.id,
      model: input.model,
      messageCount: input.messages.length,
      toolNames: (input.tools ?? []).map((tool) => tool.name).sort(),
    });

    for (const action of step.actions) {
      const event = await this.executeAction(action, input.abortSignal);
      if (event) yield event;
    }
  }

  public assertExhausted(): void {
    if (this.cursor === this.scenario.steps.length) return;
    const remaining = this.scenario.steps
      .slice(this.cursor)
      .map((step) => step.id)
      .join(", ");
    throw new ScriptedProviderFault(
      `Scripted provider scenario "${this.scenario.id}" did not consume ${this.scenario.steps.length - this.cursor} step(s): ${remaining}.`,
      undefined,
      "scenario_incomplete",
    );
  }

  private async executeAction(
    action: ScriptedAction,
    signal?: AbortSignal,
  ): Promise<ModelEvent | undefined> {
    if (action.type === "wait") {
      await this.controller.wait(action.gate, signal, action.honorAbort);
      return undefined;
    }
    if (action.type === "throw" || action.type === "error_event") {
      const fault = new ScriptedProviderFault(
        action.message,
        action.status,
        action.code,
        action.retryable,
      );
      if (action.type === "throw") throw fault;
      return { type: "error", error: fault };
    }
    if (action.type === "tool_call") {
      return {
        type: "tool_call",
        toolCall: {
          id: action.id,
          name: action.name,
          arguments:
            typeof action.arguments === "string"
              ? action.arguments
              : JSON.stringify(action.arguments),
        },
      };
    }
    if (action.type === "usage") {
      const totalTokens = action.inputTokens + action.outputTokens;
      return {
        type: "usage",
        usage: {
          inputTokens: action.inputTokens,
          outputTokens: action.outputTokens,
          totalTokens,
          cacheReadTokens: action.cacheReadTokens,
        },
      };
    }
    return action;
  }
}

function assertRequest(
  stepId: string,
  expectation: ScriptedProviderScenario["steps"][number]["expect"],
  input: ModelChatInput,
): void {
  if (expectation.model && expectation.model !== input.model) {
    throw contractError(
      stepId,
      `expected model "${expectation.model}", received "${input.model}"`,
    );
  }
  const messages = JSON.stringify(input.messages);
  for (const fragment of expectation.messageIncludes) {
    if (!messages.includes(fragment)) {
      throw contractError(stepId, `request messages omitted "${fragment}"`);
    }
  }
  const availableTools = new Set((input.tools ?? []).map((tool) => tool.name));
  for (const name of expectation.toolNames) {
    if (!availableTools.has(name)) {
      throw contractError(stepId, `request tool catalog omitted "${name}"`);
    }
  }
  const results = input.messages.flatMap((message) =>
    message.content.flatMap((block) =>
      block.type === "tool_result" ? [block.toolResult] : [],
    ),
  );
  for (const expected of expectation.toolResults) {
    const matching = results.filter(
      (result) => result.toolCallId === expected.toolCallId,
    );
    if (matching.length !== 1) {
      throw contractError(
        stepId,
        `expected exactly one result for tool call "${expected.toolCallId}", received ${matching.length}`,
      );
    }
    const result = matching[0];
    if (
      result.name !== expected.name ||
      Boolean(result.isError) !== expected.isError ||
      expected.contentIncludes.some(
        (fragment) => !result.content.includes(fragment),
      )
    ) {
      throw contractError(
        stepId,
        `tool result "${expected.toolCallId}" violated its name, status, or content contract`,
      );
    }
  }
}

function contractError(stepId: string, detail: string): ScriptedProviderFault {
  return new ScriptedProviderFault(
    `Scripted provider request contract failed at step "${stepId}": ${detail}.`,
    undefined,
    "request_contract_failed",
  );
}

function abortError(gate: string): DOMException {
  return new DOMException(
    `Scripted provider gate "${gate}" was cancelled.`,
    "AbortError",
  );
}
