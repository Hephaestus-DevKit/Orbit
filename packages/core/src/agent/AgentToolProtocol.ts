import { randomUUID } from "crypto";
import { z } from "zod";
import type { OrbitToolCall } from "@orbit-build/model-providers";

export interface ToolPromptDefinition {
  name: string;
  description: string;
  inputSchema?: z.ZodTypeAny;
  inputJsonSchema?: Record<string, unknown>;
}

interface PromptFieldDescription {
  typeName: string;
  isOptional: boolean;
  values?: string;
  description?: string;
}

export function generateXMLToolsPrompt(tools: ToolPromptDefinition[]): string {
  const lines = [
    "",
    "",
    "### Tool Use Instructions",
    "You can execute tasks by calling tools. To call a tool, wrap it in a <tool_call> XML block with the correct parameter tags.",
    "Format:",
    '<tool_call name="tool_name">',
    "  <param_name>value</param_name>",
    "</tool_call>",
    "",
    "Crucial XML Rules:",
    "1. DO NOT escape special characters (like <, >, &) inside parameter tags (e.g. inside <content> or <newText>). Write them raw. The parser handles raw content.",
    "2. Ensure parameter tag names match the parameter names exactly (case-sensitive).",
    "3. You can execute multiple tool calls in a single turn.",
    "",
    "Available Tools:",
    "",
  ];

  for (const tool of tools) {
    lines.push(`- **${tool.name}**: ${tool.description}`, "  Parameters:");
    if (tool.inputSchema instanceof z.ZodObject) {
      for (const [key, property] of Object.entries(
        tool.inputSchema.shape,
      ) as Array<[string, z.ZodTypeAny]>) {
        const field = describeZodPromptField(property);
        const values = field.values ? `, values: ${field.values}` : "";
        const description = field.description
          ? ` - ${field.description.replace(/\s+/g, " ").trim()}`
          : "";
        lines.push(
          `    - \`${key}\`: (type: ${field.typeName}${field.isOptional ? ", optional" : ""}${values})${description}`,
        );
      }
    } else if (tool.inputJsonSchema) {
      const properties = tool.inputJsonSchema.properties;
      const required = new Set(
        Array.isArray(tool.inputJsonSchema.required)
          ? tool.inputJsonSchema.required.filter(
              (value): value is string => typeof value === "string",
            )
          : [],
      );
      if (properties && typeof properties === "object") {
        for (const [key, value] of Object.entries(properties)) {
          const property =
            value && typeof value === "object"
              ? (value as Record<string, unknown>)
              : {};
          const typeName =
            typeof property.type === "string" ? property.type : "unknown";
          const description =
            typeof property.description === "string"
              ? ` - ${property.description.replace(/\s+/g, " ").trim()}`
              : "";
          lines.push(
            `    - \`${key}\`: (type: ${typeName}${required.has(key) ? "" : ", optional"})${description}`,
          );
        }
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function generateNativeToolsPrompt(
  tools: Array<Pick<ToolPromptDefinition, "name" | "description">>,
): string {
  const names = tools
    .map((tool) => tool.name)
    .sort()
    .join(", ");
  return [
    "### Native Tool Use",
    "Use the provided native function tools when an operation requires workspace access.",
    "Validate every argument against the supplied schema, use exact tool names, and wait for tool results before claiming success.",
    "Do not print XML <tool_call> blocks or imitate tool calls in normal response text.",
    `Available tools: ${names || "none"}.`,
  ].join("\n");
}

function describeZodPromptField(schema: z.ZodTypeAny): PromptFieldDescription {
  let current = schema;
  let isOptional = false;

  while (true) {
    if (current instanceof z.ZodOptional) {
      isOptional = true;
      current = current.unwrap();
    } else if (current instanceof z.ZodDefault) {
      isOptional = true;
      current = current.removeDefault();
    } else if (current instanceof z.ZodNullable) {
      current = current.unwrap();
    } else if (current instanceof z.ZodEffects) {
      current = current.innerType();
    } else {
      break;
    }
  }

  return {
    typeName: String(current._def.typeName).replace("Zod", "").toLowerCase(),
    isOptional,
    values:
      current instanceof z.ZodEnum ? current.options.join(", ") : undefined,
    description: schema.description ?? current.description,
  };
}

export function parseXMLToolCalls(text: string): OrbitToolCall[] {
  const toolCalls: OrbitToolCall[] = [];
  const toolCallPattern =
    /<tool_call\s+name="([^"]+)"\s*>([\s\S]*?)<\/tool_call>/g;
  let toolCallMatch: RegExpExecArray | null;

  while ((toolCallMatch = toolCallPattern.exec(text)) !== null) {
    const argumentsRecord: Record<string, unknown> = {};
    const parameterPattern = /<([a-zA-Z0-9_]+)\s*>([\s\S]*?)<\/\1\s*>/g;
    let parameterMatch: RegExpExecArray | null;

    while (
      (parameterMatch = parameterPattern.exec(toolCallMatch[2])) !== null
    ) {
      argumentsRecord[parameterMatch[1]] = parseToolArgument(
        trimOneBoundaryNewline(parameterMatch[2]),
      );
    }

    toolCalls.push({
      id: `xml_call_${randomUUID()}`,
      name: toolCallMatch[1],
      arguments: JSON.stringify(argumentsRecord),
    });
  }
  return toolCalls;
}

/**
 * Recover tool calls that local/weak models emit as plain response text
 * instead of native function calls: Hermes/Qwen-style bare `<tool_call>`
 * tags wrapping JSON, and fenced ```json blocks shaped like a tool call.
 *
 * Loose text formats are prone to false positives (e.g. a JSON example in an
 * explanation), so a candidate is only accepted when `isKnownTool` confirms
 * the parsed name is a registered tool.
 */
export function parseTextToolCalls(
  text: string,
  isKnownTool: (name: string) => boolean,
): OrbitToolCall[] {
  const toolCalls: OrbitToolCall[] = [];
  const candidates: string[] = [];

  const bareTagPattern = /<tool_call\s*>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let match: RegExpExecArray | null;
  while ((match = bareTagPattern.exec(text)) !== null) {
    candidates.push(match[1]);
  }

  const fencePattern = /```(?:json|tool_call|tool_code)?\s*\n([\s\S]*?)```/g;
  while ((match = fencePattern.exec(text)) !== null) {
    candidates.push(match[1].trim());
  }

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    for (const entry of Array.isArray(parsed) ? parsed : [parsed]) {
      const normalized = normalizeTextToolCall(entry);
      if (normalized && isKnownTool(normalized.name)) {
        toolCalls.push({
          id: `text_call_${randomUUID()}`,
          name: normalized.name,
          arguments: normalized.arguments,
        });
      }
    }
  }
  return toolCalls;
}

function normalizeTextToolCall(
  entry: unknown,
): { name: string; arguments: string } | null {
  if (entry === null || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const name = record.name ?? record.tool ?? record.tool_name;
  if (typeof name !== "string" || !name) return null;
  const rawArguments =
    record.arguments ?? record.parameters ?? record.input ?? {};
  if (typeof rawArguments === "string") {
    return { name, arguments: rawArguments };
  }
  if (rawArguments !== null && typeof rawArguments === "object") {
    return { name, arguments: JSON.stringify(rawArguments) };
  }
  return null;
}

function trimOneBoundaryNewline(value: string): string {
  return value.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
}

function parseToolArgument(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return Number.parseFloat(value);
  if (
    (value.startsWith("[") && value.endsWith("]")) ||
    (value.startsWith("{") && value.endsWith("}"))
  ) {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      // Preserve malformed JSON-like input as text for downstream validation.
    }
  }
  return value;
}
