import Ajv, { type ErrorObject } from "ajv";
import { z } from "zod";

const MAX_MCP_INPUT_SCHEMA_BYTES = 256 * 1024;
const MAX_VALIDATION_ERRORS = 12;
const ajv = new Ajv({
  allErrors: true,
  strict: false,
  allowUnionTypes: true,
  validateFormats: false,
});

/**
 * Compile one server-provided MCP JSON Schema into Orbit's runtime validator.
 *
 * MCP tool schemas cross a trust boundary. The model-facing JSON Schema and
 * the execution-time validator must therefore be the same contract.
 */
export function createMcpInputSchema(
  jsonSchema: Record<string, unknown>,
  toolName: string,
): z.ZodType<Record<string, unknown>> {
  const serialized = JSON.stringify(jsonSchema);
  if (Buffer.byteLength(serialized, "utf8") > MAX_MCP_INPUT_SCHEMA_BYTES) {
    throw new Error(
      `MCP tool "${toolName}" input schema exceeds the 256 KiB limit.`,
    );
  }

  let validate: ReturnType<typeof ajv.compile>;
  try {
    validate = ajv.compile(jsonSchema);
  } catch (error: unknown) {
    throw new Error(
      `MCP tool "${toolName}" has an invalid input schema: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return z.record(z.unknown()).superRefine((value, context) => {
    if (validate(value)) return;
    for (const error of (validate.errors || []).slice(
      0,
      MAX_VALIDATION_ERRORS,
    )) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: jsonPointerPath(error.instancePath),
        message: formatValidationError(error),
      });
    }
  });
}

/** Compile a server-provided output schema into a reusable result validator. */
export function createMcpOutputValidator(
  jsonSchema: Record<string, unknown>,
  toolName: string,
): (value: unknown) => void {
  const serialized = JSON.stringify(jsonSchema);
  if (Buffer.byteLength(serialized, "utf8") > MAX_MCP_INPUT_SCHEMA_BYTES) {
    throw new Error(
      `MCP tool "${toolName}" output schema exceeds the 256 KiB limit.`,
    );
  }

  let validate: ReturnType<typeof ajv.compile>;
  try {
    validate = ajv.compile(jsonSchema);
  } catch (error: unknown) {
    throw new Error(
      `MCP tool "${toolName}" has an invalid output schema: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return (value: unknown): void => {
    if (validate(value)) return;
    const detail = (validate.errors || [])
      .slice(0, MAX_VALIDATION_ERRORS)
      .map(formatValidationError)
      .join("; ");
    throw new Error(
      `MCP tool "${toolName}" returned structured content that does not match ` +
        `its output schema${detail ? `: ${detail}` : "."}`,
    );
  };
}

function jsonPointerPath(pointer: string): Array<string | number> {
  if (!pointer) return [];
  return pointer
    .split("/")
    .slice(1)
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"))
    .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
}

function formatValidationError(error: ErrorObject): string {
  const location = error.instancePath || "/";
  return `${location} ${error.message || "is invalid"}`.slice(0, 500);
}
