import { z } from "zod";
import type {
  OrbitTool,
  ToolExecutionContract,
  ToolFailure,
  ToolResult,
} from "./types.js";

export const ToolExecutionContractMetadataSchema = z
  .object({
    version: z.literal(2),
    readOnly: z.boolean(),
    idempotent: z.boolean(),
    concurrency: z.enum(["exclusive", "parallel"]),
    cancellation: z.enum(["boundary", "cooperative"]),
    timeoutMs: z.number().int().min(1_000).max(86_400_000).optional(),
    outputSchema: z
      .custom<z.ZodTypeAny>(
        (value) =>
          typeof value === "object" &&
          value !== null &&
          typeof (value as { safeParse?: unknown }).safeParse === "function",
        "outputSchema must expose a safeParse function.",
      )
      .optional(),
    outputJsonSchema: z.record(z.unknown()).optional(),
    presentation: z
      .object({
        modelMaxChars: z.number().int().positive().max(10_000_000).optional(),
        userMaxChars: z.number().int().positive().max(10_000_000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((contract, context) => {
    if (contract.concurrency === "parallel" && !contract.readOnly) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["concurrency"],
        message: "Parallel tools must declare readOnly: true.",
      });
    }
    if (contract.concurrency === "parallel" && !contract.idempotent) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["idempotent"],
        message: "Parallel tools must declare idempotent: true.",
      });
    }
  });

const LEGACY_EXECUTION_CONTRACT: Readonly<ToolExecutionContract<unknown>> = {
  version: 2,
  readOnly: false,
  idempotent: false,
  concurrency: "exclusive",
  cancellation: "boundary",
};

const ToolResultEnvelopeSchema = z
  .object({
    ok: z.boolean(),
    data: z.unknown().optional(),
    error: z.string().optional(),
    display: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
    failure: z
      .object({
        code: z.string().trim().min(1),
        message: z.string().trim().min(1),
        retryable: z.boolean(),
        details: z.record(z.unknown()).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

/** Resolve legacy tools to conservative execution semantics. */
export function resolveToolExecutionContract(
  tool: OrbitTool<unknown, unknown>,
): Readonly<ToolExecutionContract<unknown>> {
  return tool.execution ?? LEGACY_EXECUTION_CONTRACT;
}

/** Only explicitly read-only and idempotent v2 tools may overlap. */
export function isParallelTool(tool: OrbitTool<unknown, unknown>): boolean {
  const contract = resolveToolExecutionContract(tool);
  return (
    contract.version === 2 &&
    contract.readOnly &&
    contract.idempotent &&
    contract.concurrency === "parallel"
  );
}

/** Validate the result envelope and an optional successful output contract. */
export function validateToolResult(
  tool: OrbitTool<unknown, unknown>,
  value: unknown,
): ToolResult<unknown> {
  const envelope = ToolResultEnvelopeSchema.safeParse(value);
  if (!envelope.success) {
    return contractFailure(
      "invalid_output",
      `Tool "${tool.name}" returned an invalid result envelope.`,
    );
  }
  const result = envelope.data;
  if (!result.ok) {
    const message =
      result.error?.trim() ||
      result.failure?.message ||
      `Tool "${tool.name}" failed.`;
    return {
      ...result,
      error: message,
      failure: result.failure ?? {
        code: "execution_error",
        message,
        retryable: false,
      },
    };
  }

  const outputSchema = tool.execution?.outputSchema;
  if (!outputSchema) return result;
  try {
    const parsed = outputSchema.safeParse(result.data);
    if (parsed.success) return { ...result, data: parsed.data };
    const issue = parsed.error.issues[0];
    const location = issue?.path.length ? issue.path.join(".") : "data";
    return contractFailure(
      "invalid_output",
      `Tool "${tool.name}" output validation failed at ${location}: ${issue?.message ?? "invalid value"}`,
    );
  } catch {
    return contractFailure(
      "invalid_output",
      `Tool "${tool.name}" output validator threw an exception.`,
    );
  }
}

export function contractFailure(
  code: ToolFailure["code"],
  message: string,
  retryable = false,
  details?: Record<string, unknown>,
): ToolResult<never> {
  return {
    ok: false,
    error: message,
    failure: { code, message, retryable, ...(details ? { details } : {}) },
  };
}
