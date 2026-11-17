import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { redactSecrets } from "@orbit-build/shared";
import type {
  MCPInteractionHandlers,
  MCPServerInteractionRequest,
  MCPRootsList,
} from "@orbit-build/mcp";
import type {
  ModelProvider,
  ModelChatInput,
  OrbitMessage,
  OrbitContentBlock,
} from "@orbit-build/model-providers";
import type { UserInteraction } from "./AgentInteraction.js";

export interface AgentMcpInteractionPorts {
  cwd: string;
  getInteraction(): UserInteraction;
  getProvider(): Pick<ModelProvider, "chat">;
  getModel(): string;
}

/** Own MCP approvals, cancellation, and bounded nested model interactions. */
export class AgentMcpInteractionHost {
  constructor(private readonly ports: AgentMcpInteractionPorts) {}
  private get cwd(): string {
    return this.ports.cwd;
  }
  private get interaction(): UserInteraction {
    return this.ports.getInteraction();
  }
  private askSelect(
    message: string,
    options: Array<{ value: string; label: string; hint?: string }>,
  ): Promise<string | null> {
    return (
      this.interaction.prompt?.askSelect(message, options) ??
      Promise.resolve(null)
    );
  }

  private askText(
    message: string,
    initialValue?: string,
  ): Promise<string | null> {
    return (
      this.interaction.prompt?.askText(message, initialValue) ??
      Promise.resolve(null)
    );
  }

  /** Host MCP interactions through the same approval and prompt surface as native Agent work. */
  public createHandlers(): MCPInteractionHandlers {
    return {
      onElicitation: (request, signal) =>
        this.handleMcpElicitation(request, signal),
      onRootsList: (_request, signal) => this.handleMcpRoots(signal),
      onSampling: (request, signal) => this.handleMcpSampling(request, signal),
    };
  }

  private async handleMcpRoots(signal: AbortSignal): Promise<MCPRootsList> {
    if (signal.aborted) {
      throw new DOMException("MCP roots request cancelled.", "AbortError");
    }
    const root = path.resolve(this.cwd);
    return {
      roots: [
        { uri: pathToFileURL(root).href, name: path.basename(root) || root },
      ],
    };
  }

  private async handleMcpElicitation(
    request: MCPServerInteractionRequest,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const params = request.params;
    const message = boundedInteractionText(
      params.message,
      "MCP server requested additional information.",
    );
    const serverLabel = request.serverName
      ? ` from "${request.serverName}"`
      : "";
    const mode = params.mode === "url" ? "url" : "form";
    if (!this.interaction.prompt) return { action: "cancel" };

    if (mode === "url") {
      const url = typeof params.url === "string" ? params.url : "";
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error("MCP URL elicitation contained an invalid URL.");
      }
      if (!/^https?:$/.test(parsed.protocol)) {
        throw new Error("MCP URL elicitation requires an HTTP(S) URL.");
      }
      const approved = await this.awaitMcpInteraction(
        this.interaction.askApproval(
          `MCP server${serverLabel} requests an external interaction. Review the full URL before opening it:\n${parsed.href}\n\n${message}`,
        ),
        signal,
      );
      return { action: approved ? "accept" : "decline" };
    }

    const schema = isRecord(params.requestedSchema)
      ? params.requestedSchema
      : undefined;
    const properties =
      schema && isRecord(schema.properties) ? schema.properties : {};
    const required = new Set(
      Array.isArray(schema?.required)
        ? schema.required.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
    );
    const content: Record<string, unknown> = {};
    for (const [key, rawDefinition] of Object.entries(properties).slice(
      0,
      25,
    )) {
      const definition = isRecord(rawDefinition) ? rawDefinition : {};
      if (
        /(password|passcode|token|secret|api[-_ ]?key|credential)/i.test(key)
      ) {
        return { action: "decline" };
      }
      const description = boundedInteractionText(definition.description, key);
      const options = enumOptions(definition);
      const answer =
        options.length > 0
          ? await this.awaitMcpInteraction(
              this.askSelect(
                `${message}\n${description}${required.has(key) ? " (required)" : " (optional)"}`,
                options.map((value) => ({ value, label: value })),
              ),
              signal,
            )
          : await this.awaitMcpInteraction(
              this.askText(
                `${message}\n${description}${required.has(key) ? " (required)" : " (optional)"}`,
                primitiveDefault(definition.default),
              ),
              signal,
            );
      if (answer === null) return { action: "cancel" };
      if (answer === "" && !required.has(key)) continue;
      if (answer === "" && required.has(key)) return { action: "cancel" };
      const converted = convertElicitationValue(answer, definition.type);
      if (converted === undefined) {
        if (required.has(key)) return { action: "decline" };
        continue;
      }
      content[key] = converted;
    }

    const approved = await this.awaitMcpInteraction(
      this.interaction.askApproval(
        `Submit the reviewed response to MCP server${serverLabel}?\n${JSON.stringify(content)}`,
      ),
      signal,
    );
    return approved ? { action: "accept", content } : { action: "decline" };
  }

  private async handleMcpSampling(
    request: MCPServerInteractionRequest,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const params = request.params;
    if (Array.isArray(params.tools) && params.tools.length > 0) {
      throw new Error(
        "MCP sampling with tools is not enabled for this host yet.",
      );
    }
    const messages = parseMcpSamplingMessages(params.messages);
    if (messages.length === 0) {
      throw new Error("MCP sampling requires at least one text message.");
    }
    const serverLabel = request.serverName
      ? ` from "${request.serverName}"`
      : "";
    const approved = await this.awaitMcpInteraction(
      this.interaction.askApproval(
        `Allow MCP server${serverLabel} to use the active model for a nested sampling request?\n${truncateInteractionText(messages.map((item) => item.content.map((block) => (block.type === "text" ? block.text : "[multimodal]")).join(" ")).join("\n"), 2_000)}`,
      ),
      signal,
    );
    if (!approved)
      throw new Error("MCP sampling request was denied by the user.");
    const model = this.ports.getModel();
    const input: ModelChatInput = {
      model,
      messages,
      system:
        typeof params.systemPrompt === "string"
          ? params.systemPrompt.slice(0, 20_000)
          : undefined,
      maxTokens:
        typeof params.maxTokens === "number" &&
        Number.isFinite(params.maxTokens)
          ? Math.max(1, Math.min(Math.floor(params.maxTokens), 32_000))
          : undefined,
      stream: true,
      abortSignal: signal,
    };
    let text = "";
    let resolvedModel = model;
    for await (const event of this.ports.getProvider().chat(input)) {
      if (signal.aborted) {
        throw new DOMException("MCP sampling request cancelled.", "AbortError");
      }
      if (event.type === "text_delta") text += event.text;
      else if (event.type === "response_metadata") {
        resolvedModel = event.resolvedModel ?? event.requestedModel;
      } else if (event.type === "tool_call") {
        throw new Error(
          "MCP sampling provider returned an unexpected tool call.",
        );
      } else if (event.type === "error") {
        throw event.error instanceof Error
          ? event.error
          : new Error(String(event.error));
      }
    }
    if (!text.trim())
      throw new Error("MCP sampling provider returned no text.");
    return {
      role: "assistant",
      content: { type: "text", text: truncateInteractionText(text, 64_000) },
      model: resolvedModel,
      stopReason: "endTurn",
    };
  }

  private async awaitMcpInteraction<T>(
    promise: Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    if (signal.aborted) {
      throw new DOMException("MCP interaction cancelled.", "AbortError");
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = () =>
        reject(new DOMException("MCP interaction cancelled.", "AbortError"));
      signal.addEventListener("abort", onAbort, { once: true });
      promise
        .then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", onAbort));
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncateInteractionText(value: string, maxChars: number): string {
  const clean = redactSecrets(String(value))
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .trim();
  return clean.length <= maxChars ? clean : `${clean.slice(0, maxChars - 1)}…`;
}

function boundedInteractionText(value: unknown, fallback: string): string {
  return truncateInteractionText(
    typeof value === "string" && value.trim() ? value : fallback,
    2_000,
  );
}

function enumOptions(definition: Record<string, unknown>): string[] {
  const values = Array.isArray(definition.enum)
    ? definition.enum
    : Array.isArray(definition.oneOf)
      ? definition.oneOf.flatMap((item) =>
          isRecord(item) && typeof item.const === "string" ? [item.const] : [],
        )
      : [];
  return values
    .filter((value): value is string => typeof value === "string")
    .slice(0, 50)
    .map((value) => truncateInteractionText(value, 200));
}

function primitiveDefault(value: unknown): string | undefined {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? String(value)
    : undefined;
}

function convertElicitationValue(
  value: string,
  type: unknown,
): string | number | boolean | undefined {
  if (type === "boolean") {
    if (/^(true|yes|y)$/i.test(value)) return true;
    if (/^(false|no|n)$/i.test(value)) return false;
    return undefined;
  }
  if (type === "number" || type === "integer") {
    const parsed = Number(value);
    if (
      !Number.isFinite(parsed) ||
      (type === "integer" && !Number.isInteger(parsed))
    )
      return undefined;
    return parsed;
  }
  return truncateInteractionText(value, 8_192);
}

function parseMcpSamplingMessages(value: unknown): OrbitMessage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 32).flatMap((rawMessage, messageIndex) => {
    if (
      !isRecord(rawMessage) ||
      (rawMessage.role !== "user" && rawMessage.role !== "assistant")
    )
      return [];
    const rawContent = Array.isArray(rawMessage.content)
      ? rawMessage.content
      : [rawMessage.content];
    const content: OrbitContentBlock[] = rawContent
      .slice(0, 64)
      .flatMap<OrbitContentBlock>((rawBlock): OrbitContentBlock[] => {
        if (!isRecord(rawBlock)) return [];
        if (rawBlock.type === "text" && typeof rawBlock.text === "string") {
          return [
            {
              type: "text",
              text: truncateInteractionText(rawBlock.text, 64_000),
            },
          ];
        }
        if (
          rawBlock.type === "image" &&
          typeof rawBlock.data === "string" &&
          typeof rawBlock.mimeType === "string" &&
          /^image\/(png|jpeg|gif|webp)$/.test(rawBlock.mimeType)
        ) {
          return [
            {
              type: "image",
              mediaType: rawBlock.mimeType as
                "image/png" | "image/jpeg" | "image/gif" | "image/webp",
              data: rawBlock.data.slice(0, 8 * 1024 * 1024),
            },
          ];
        }
        return [];
      });
    return content.length > 0
      ? [
          {
            id: randomUUID(),
            role: rawMessage.role,
            content,
            createdAt: new Date().toISOString(),
            metadata: { source: "mcp-sampling", messageIndex },
          },
        ]
      : [];
  });
}
