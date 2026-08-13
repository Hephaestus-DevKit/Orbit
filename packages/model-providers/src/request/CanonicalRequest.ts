import { createHash } from "crypto";
import { canonicalizeJson, canonicalJsonStringify } from "@orbit-build/shared";
import type { ModelChatInput, OrbitToolDefinition } from "../types.js";
import { zodToJsonSchema } from "../utils.js";

const MAX_PROVIDER_TOOLS = 128;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function normalizeJsonSchemaSets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonSchemaSets(item));
  }
  if (value === null || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      key === "required" &&
      Array.isArray(item) &&
      item.every((entry): entry is string => typeof entry === "string")
    ) {
      result[key] = [...item].sort();
    } else {
      result[key] = normalizeJsonSchemaSets(item);
    }
  }
  return result;
}

/** Provider-facing tool definition with a materialized, canonical JSON Schema. */
export interface CanonicalToolDefinition extends OrbitToolDefinition {
  inputJsonSchema: Record<string, unknown>;
}

/**
 * Materialize and order a model-facing tool catalog deterministically.
 *
 * Stable catalog bytes are important for provider prefix caching and make
 * request traces reproducible even when tools were registered concurrently.
 */
export function canonicalizeToolDefinitions(
  tools: readonly OrbitToolDefinition[] | undefined,
): CanonicalToolDefinition[] | undefined {
  if (tools === undefined) return undefined;
  if (tools.length > MAX_PROVIDER_TOOLS) {
    throw new Error(
      `Provider requests support at most ${MAX_PROVIDER_TOOLS} tools.`,
    );
  }

  const seen = new Set<string>();
  const canonical = tools.map((tool) => {
    if (!TOOL_NAME_PATTERN.test(tool.name)) {
      throw new Error(
        `Invalid provider tool name "${tool.name}". Use 1-64 letters, digits, underscores, or hyphens.`,
      );
    }
    if (seen.has(tool.name)) {
      throw new Error(`Duplicate provider tool name "${tool.name}".`);
    }
    seen.add(tool.name);
    const schema = canonicalizeJson(
      normalizeJsonSchemaSets(
        tool.inputJsonSchema ?? zodToJsonSchema(tool.inputSchema),
      ),
    );
    if (
      Array.isArray(schema) ||
      schema === null ||
      typeof schema !== "object"
    ) {
      throw new Error(
        `Provider tool "${tool.name}" must use an object JSON Schema.`,
      );
    }
    return {
      ...tool,
      inputJsonSchema: schema as Record<string, unknown>,
    };
  });
  canonical.sort((left, right) => left.name.localeCompare(right.name, "en"));
  return canonical;
}

/** Return a stable fingerprint for the exact model-facing tool catalog. */
export function toolDefinitionsFingerprint(
  tools: readonly OrbitToolDefinition[] | undefined,
): string {
  const canonical = canonicalizeToolDefinitions(tools) ?? [];
  const wireCatalog = canonical.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputJsonSchema,
  }));
  return createHash("sha256")
    .update(canonicalJsonStringify(wireCatalog))
    .digest("hex");
}

/** Clone a model request with a deterministic provider-facing tool catalog. */
export function canonicalizeModelChatInput(
  input: ModelChatInput,
): ModelChatInput {
  const tools = canonicalizeToolDefinitions(input.tools);
  return tools === undefined ? input : { ...input, tools };
}

/** Validate the official DeepSeek cache-isolation and scheduling identifier. */
export function validateDeepSeekUserId(userId: string | undefined): void {
  if (userId === undefined) return;
  if (userId.length === 0 || userId.length > 512) {
    throw new Error(
      "DeepSeek user_id must contain between 1 and 512 characters.",
    );
  }
}
