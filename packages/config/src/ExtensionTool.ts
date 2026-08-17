import { createHash } from "crypto";
import { extname } from "path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { readBoundedRegularFile, resolveSafePath } from "@orbit-build/shared";

export const ORBIT_EXTENSION_TOOL_VERSION = 1 as const;
export const ORBIT_EXTENSION_TOOL_INPUT_PROTOCOL =
  "orbit-extension-tool-input-v1" as const;
export const ORBIT_EXTENSION_TOOL_RESULT_PROTOCOL =
  "orbit-extension-tool-result-v1" as const;

const MAX_EXTENSION_TOOL_DEFINITION_BYTES = 512 * 1024;
const MAX_SCHEMA_DEPTH = 8;
const MAX_SCHEMA_PROPERTIES = 100;
const PropertyNamePattern = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;

type JsonPrimitive = string | number | boolean | null;

interface ExtensionToolSchemaBase {
  description?: string;
}

export interface ExtensionToolStringSchema extends ExtensionToolSchemaBase {
  type: "string";
  minLength?: number;
  maxLength?: number;
  enum?: string[];
}

export interface ExtensionToolNumberSchema extends ExtensionToolSchemaBase {
  type: "number" | "integer";
  minimum?: number;
  maximum?: number;
  enum?: number[];
}

export interface ExtensionToolBooleanSchema extends ExtensionToolSchemaBase {
  type: "boolean";
}

export interface ExtensionToolArraySchema extends ExtensionToolSchemaBase {
  type: "array";
  items: ExtensionToolValueSchema;
  maxItems: number;
}

export interface ExtensionToolObjectSchema extends ExtensionToolSchemaBase {
  type: "object";
  properties: Record<string, ExtensionToolValueSchema>;
  required: string[];
  additionalProperties: false;
}

export type ExtensionToolValueSchema =
  | ExtensionToolStringSchema
  | ExtensionToolNumberSchema
  | ExtensionToolBooleanSchema
  | ExtensionToolArraySchema
  | ExtensionToolObjectSchema;

export interface ExtensionToolDefinition {
  schemaVersion: typeof ORBIT_EXTENSION_TOOL_VERSION;
  description: string;
  runtime: "node";
  entrypoint: string;
  args: string[];
  inputSchema: ExtensionToolObjectSchema;
  timeoutMs: number;
  maxOutputBytes: number;
}

const RelativeEntrypointSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (value) =>
      !value.includes("\0") &&
      !/^(?:[A-Za-z]:[\\/]|[\\/])/.test(value) &&
      !/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(value),
    "The extension tool entrypoint must remain inside the extension directory.",
  )
  .refine(
    (value) => /\.(?:cjs|mjs|js)$/i.test(value),
    "The extension tool entrypoint must be a Node.js .js, .mjs, or .cjs file.",
  );

export const ExtensionToolDefinitionSchema: z.ZodType<
  ExtensionToolDefinition,
  z.ZodTypeDef,
  unknown
> = z.object({
  schemaVersion: z.literal(ORBIT_EXTENSION_TOOL_VERSION),
  description: z.string().trim().min(1).max(20_000),
  runtime: z.literal("node"),
  entrypoint: RelativeEntrypointSchema,
  args: z.array(z.string().max(4096)).max(64).default([]),
  inputSchema: z.unknown().transform((value, context) => {
    try {
      const parsed = parseValueSchema(value, 0, "inputSchema");
      if (parsed.type !== "object") {
        throw new Error("inputSchema must have type object.");
      }
      return parsed;
    } catch (error: unknown) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : String(error),
      });
      return z.NEVER;
    }
  }),
  timeoutMs: z.number().int().min(100).max(600_000).default(30_000),
  maxOutputBytes: z
    .number()
    .int()
    .min(1024)
    .max(8 * 1024 * 1024)
    .default(1024 * 1024),
});

/** Load a bounded declarative tool definition without executing extension code. */
export function loadExtensionToolDefinition(
  extensionRoot: string,
  definitionPath: string,
): ExtensionToolDefinition {
  const resolved = resolveSafePath(extensionRoot, definitionPath);
  const raw = readBoundedRegularFile(
    resolved,
    MAX_EXTENSION_TOOL_DEFINITION_BYTES,
  );
  if (raw === undefined) {
    throw new Error(
      `Extension tool definition was not found: ${definitionPath}`,
    );
  }
  const value =
    extname(resolved).toLowerCase() === ".json"
      ? JSON.parse(raw)
      : parseYaml(raw);
  return ExtensionToolDefinitionSchema.parse(value);
}

/** Convert an extension/tool identity into a provider-safe, collision-resistant name. */
export function createExtensionToolRuntimeName(
  extensionId: string,
  contributionName: string,
): string {
  const readable =
    `${extensionId}_${contributionName}`
      .replace(/[^A-Za-z0-9_-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || "tool";
  const digest = createHash("sha256")
    .update(`${extensionId}\0${contributionName}`, "utf8")
    .digest("hex")
    .slice(0, 8);
  return `ext__${readable.slice(0, 49)}__${digest}`;
}

/** Build a strict Zod execution boundary from the admitted JSON-schema subset. */
export function createExtensionToolInputSchema(
  schema: ExtensionToolObjectSchema,
): z.ZodType<Record<string, unknown>> {
  return z.record(z.unknown()).superRefine((value, context) => {
    const issues: Array<{ path: Array<string | number>; message: string }> = [];
    validateValue(schema, value, [], issues);
    for (const issue of issues.slice(0, 100)) {
      context.addIssue({
        code: "custom",
        path: issue.path,
        message: issue.message,
      });
    }
  });
}

function parseValueSchema(
  value: unknown,
  depth: number,
  path: string,
): ExtensionToolValueSchema {
  if (depth > MAX_SCHEMA_DEPTH) {
    throw new Error(`${path} exceeds the maximum schema depth.`);
  }
  const record = requireRecord(value, path);
  rejectUnknownKeys(record, path, [
    "type",
    "description",
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "enum",
    "items",
    "maxItems",
    "properties",
    "required",
    "additionalProperties",
  ]);
  const description = optionalBoundedString(
    record.description,
    `${path}.description`,
    1000,
  );
  const type = record.type;
  if (type === "string") {
    const minLength = optionalInteger(
      record.minLength,
      `${path}.minLength`,
      0,
      100_000,
    );
    const maxLength = optionalInteger(
      record.maxLength,
      `${path}.maxLength`,
      0,
      100_000,
    );
    if (
      minLength !== undefined &&
      maxLength !== undefined &&
      minLength > maxLength
    ) {
      throw new Error(`${path}.minLength cannot exceed maxLength.`);
    }
    const enumValues = optionalPrimitiveEnum(record.enum, path, "string") as
      | string[]
      | undefined;
    return compact({
      type: "string" as const,
      description,
      minLength,
      maxLength,
      enum: enumValues,
    });
  }
  if (type === "number" || type === "integer") {
    const minimum = optionalFiniteNumber(record.minimum, `${path}.minimum`);
    const maximum = optionalFiniteNumber(record.maximum, `${path}.maximum`);
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
      throw new Error(`${path}.minimum cannot exceed maximum.`);
    }
    const enumValues = optionalPrimitiveEnum(record.enum, path, "number") as
      | number[]
      | undefined;
    if (
      type === "integer" &&
      enumValues?.some((entry) => !Number.isInteger(entry))
    ) {
      throw new Error(`${path}.enum must contain only integers.`);
    }
    return compact({
      type: type as "number" | "integer",
      description,
      minimum,
      maximum,
      enum: enumValues,
    });
  }
  if (type === "boolean") {
    return compact({ type: "boolean" as const, description });
  }
  if (type === "array") {
    const maxItems =
      optionalInteger(record.maxItems, `${path}.maxItems`, 0, 1000) ?? 100;
    return compact({
      type: "array" as const,
      description,
      items: parseValueSchema(record.items, depth + 1, `${path}.items`),
      maxItems,
    });
  }
  if (type === "object") {
    const propertiesRecord =
      record.properties === undefined
        ? {}
        : requireRecord(record.properties, `${path}.properties`);
    const entries = Object.entries(propertiesRecord);
    if (entries.length > MAX_SCHEMA_PROPERTIES) {
      throw new Error(`${path}.properties contains too many entries.`);
    }
    const properties: Record<string, ExtensionToolValueSchema> = {};
    for (const [name, child] of entries) {
      if (!PropertyNamePattern.test(name)) {
        throw new Error(`${path}.properties contains an invalid name: ${name}`);
      }
      properties[name] = parseValueSchema(
        child,
        depth + 1,
        `${path}.properties.${name}`,
      );
    }
    const required =
      record.required === undefined
        ? []
        : requireStringArray(
            record.required,
            `${path}.required`,
            MAX_SCHEMA_PROPERTIES,
          );
    for (const name of required) {
      if (!(name in properties)) {
        throw new Error(
          `${path}.required references unknown property ${name}.`,
        );
      }
    }
    if (record.additionalProperties !== false) {
      throw new Error(`${path}.additionalProperties must be false.`);
    }
    return compact({
      type: "object" as const,
      description,
      properties,
      required: [...new Set(required)],
      additionalProperties: false as const,
    });
  }
  throw new Error(`${path}.type is unsupported.`);
}

function validateValue(
  schema: ExtensionToolValueSchema,
  value: unknown,
  path: Array<string | number>,
  issues: Array<{ path: Array<string | number>; message: string }>,
): void {
  if (schema.type === "string") {
    if (typeof value !== "string")
      return addIssue(issues, path, "Expected a string.");
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      addIssue(
        issues,
        path,
        `Expected at least ${schema.minLength} characters.`,
      );
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      addIssue(
        issues,
        path,
        `Expected at most ${schema.maxLength} characters.`,
      );
    }
    if (schema.enum && !schema.enum.includes(value)) {
      addIssue(issues, path, "Value is not in the allowed enum.");
    }
    return;
  }
  if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return addIssue(issues, path, "Expected a finite number.");
    }
    if (schema.type === "integer" && !Number.isInteger(value)) {
      addIssue(issues, path, "Expected an integer.");
    }
    if (schema.minimum !== undefined && value < schema.minimum) {
      addIssue(
        issues,
        path,
        `Expected a value greater than or equal to ${schema.minimum}.`,
      );
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      addIssue(
        issues,
        path,
        `Expected a value less than or equal to ${schema.maximum}.`,
      );
    }
    if (schema.enum && !schema.enum.includes(value)) {
      addIssue(issues, path, "Value is not in the allowed enum.");
    }
    return;
  }
  if (schema.type === "boolean") {
    if (typeof value !== "boolean")
      addIssue(issues, path, "Expected a boolean.");
    return;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value))
      return addIssue(issues, path, "Expected an array.");
    if (value.length > schema.maxItems) {
      addIssue(issues, path, `Expected at most ${schema.maxItems} items.`);
      return;
    }
    value.forEach((entry, index) =>
      validateValue(schema.items, entry, [...path, index], issues),
    );
    return;
  }
  if (schema.type !== "object") return;
  if (!isRecord(value)) return addIssue(issues, path, "Expected an object.");
  for (const name of schema.required) {
    if (!(name in value))
      addIssue(issues, [...path, name], "Required property is missing.");
  }
  for (const name of Object.keys(value)) {
    const child = schema.properties[name];
    if (!child) addIssue(issues, [...path, name], "Unknown property.");
    else validateValue(child, value[name], [...path, name], issues);
  }
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  path: string,
  allowed: string[],
): void {
  const accepted = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !accepted.has(key));
  if (unknown)
    throw new Error(`${path} contains unsupported keyword ${unknown}.`);
}

function optionalBoundedString(
  value: unknown,
  path: string,
  max: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > max) {
    throw new Error(
      `${path} must be a string no longer than ${max} characters.`,
    );
  }
  return value;
}

function optionalInteger(
  value: unknown,
  path: string,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (
    !Number.isInteger(value) ||
    (value as number) < min ||
    (value as number) > max
  ) {
    throw new Error(`${path} must be an integer from ${min} to ${max}.`);
  }
  return value as number;
}

function optionalFiniteNumber(
  value: unknown,
  path: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
  return value;
}

function optionalPrimitiveEnum(
  value: unknown,
  path: string,
  expected: "string" | "number",
): JsonPrimitive[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    throw new Error(`${path}.enum must contain 1 to 50 values.`);
  }
  if (
    value.some(
      (entry) =>
        typeof entry !== expected ||
        (expected === "number" && !Number.isFinite(entry)),
    )
  ) {
    throw new Error(`${path}.enum contains a value of the wrong type.`);
  }
  return [...new Set(value as JsonPrimitive[])];
}

function requireStringArray(
  value: unknown,
  path: string,
  max: number,
): string[] {
  if (
    !Array.isArray(value) ||
    value.length > max ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(`${path} must be an array of at most ${max} strings.`);
  }
  return value as string[];
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function addIssue(
  issues: Array<{ path: Array<string | number>; message: string }>,
  path: Array<string | number>,
  message: string,
): void {
  if (issues.length < 100) issues.push({ path, message });
}
