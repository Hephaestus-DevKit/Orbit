import type { ModelChatInput } from "../types.js";
import { validateJsonObjectToolArguments } from "../ToolArguments.js";

export interface OpenAIFunctionToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type OpenAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type OpenAIRequestMessage =
  | { role: "system" | "user"; content: string | OpenAIContentPart[] }
  | {
      role: "assistant";
      content: string | null;
      reasoning_content?: string;
      tool_calls?: OpenAIFunctionToolCall[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export interface OpenAIFunctionToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

/**
 * Serialize Orbit history into the Chat Completions message vocabulary.
 * DeepSeek reasoning is replayed only for tool-call turns; V4 assistant
 * content always remains a string so reasoning-only history stays valid.
 */
export function buildDeepSeekChatMessages(
  input: ModelChatInput,
  isDeepSeekV4: boolean,
): OpenAIRequestMessage[] {
  const messages: OpenAIRequestMessage[] = [];
  for (const message of input.messages) {
    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    const images = message.content.filter((block) => block.type === "image");
    if (images.length > 0 && isDeepSeekV4) {
      throw new Error(
        "The selected DeepSeek model does not accept image input. Switch to a vision-capable model or remove the attachment.",
      );
    }

    if (message.role === "tool") {
      const results = message.content.filter(
        (block) => block.type === "tool_result",
      );
      if (results.length === 0) {
        throw new Error(
          "A tool-role message must contain at least one tool result.",
        );
      }
      for (const block of results) {
        messages.push({
          role: "tool",
          tool_call_id: block.toolResult.toolCallId,
          content: block.toolResult.content || "(no output)",
        });
      }
      continue;
    }

    const toolCalls: OpenAIFunctionToolCall[] = message.content
      .filter((block) => block.type === "tool_call")
      .map((block) => {
        if (isDeepSeekV4) {
          validateJsonObjectToolArguments(block.toolCall.arguments);
        }
        return {
          id: block.toolCall.id,
          type: "function",
          function: {
            name: block.toolCall.name,
            arguments: block.toolCall.arguments,
          },
        };
      });
    if (toolCalls.length > 0 && message.role !== "assistant") {
      throw new Error("Tool-call content is only valid in assistant messages.");
    }

    if (message.role === "assistant") {
      const reasoning = message.content
        .filter((block) => block.type === "thinking")
        .map((block) => block.text)
        .join("\n");
      const content = isDeepSeekV4
        ? text
        : reasoning
          ? `<think>\n${reasoning}\n</think>\n${text}`
          : text || null;
      const assistant: Extract<OpenAIRequestMessage, { role: "assistant" }> = {
        role: "assistant",
        content,
      };
      if (toolCalls.length > 0) {
        assistant.tool_calls = toolCalls;
        if (isDeepSeekV4) assistant.reasoning_content = reasoning || "";
      }
      messages.push(assistant);
      continue;
    }

    if (message.role === "user" && images.length > 0) {
      messages.push({
        role: "user",
        content: [
          ...(text ? [{ type: "text" as const, text }] : []),
          ...images.map((image) => ({
            type: "image_url" as const,
            image_url: { url: `data:${image.mediaType};base64,${image.data}` },
          })),
        ],
      });
    } else {
      messages.push({ role: message.role, content: text });
    }
  }
  if (input.system) messages.unshift({ role: "system", content: input.system });
  return messages;
}
