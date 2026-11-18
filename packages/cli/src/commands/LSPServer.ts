import { ConfigLoader } from "@orbit-build/config";
import { AutocompleteEngine } from "@orbit-build/core";
import { redactSecrets } from "@orbit-build/shared";
import { z } from "zod";
import { readCliVersion } from "../runtime/CliVersion.js";

const MAX_LSP_HEADER_BYTES = 8 * 1024;
const MAX_LSP_BODY_BYTES = 8 * 1024 * 1024;

const JsonRpcIdSchema = z.union([z.string(), z.number(), z.null()]);
const JSONRPCMessageSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: JsonRpcIdSchema.optional(),
    method: z.string().min(1).max(512),
    params: z.unknown().optional(),
  })
  .strict();

const TextDocumentIdentifierSchema = z.object({
  uri: z.string().min(1).max(16_384),
});
const DidOpenParamsSchema = z.object({
  textDocument: TextDocumentIdentifierSchema.extend({
    text: z.string().max(MAX_LSP_BODY_BYTES),
  }).passthrough(),
});
const DidChangeParamsSchema = z.object({
  textDocument: TextDocumentIdentifierSchema,
  contentChanges: z
    .array(z.object({ text: z.string().max(MAX_LSP_BODY_BYTES) }).passthrough())
    .min(1)
    .max(100),
});
const DidCloseParamsSchema = z.object({
  textDocument: TextDocumentIdentifierSchema,
});
const CompletionParamsSchema = z.object({
  textDocument: TextDocumentIdentifierSchema,
  position: z.object({
    line: z.number().int().nonnegative(),
    character: z.number().int().nonnegative(),
  }),
});

export type JSONRPCMessage = z.infer<typeof JSONRPCMessageSchema>;

/** Incrementally decode bounded Language Server Protocol frames. */
export class JSONRPCReader {
  private buffer = Buffer.alloc(0);
  private discardBytesRemaining = 0;
  private expectedBodyBytes: number | undefined;

  public constructor(
    private readonly onMessage: (
      message: JSONRPCMessage,
    ) => void | Promise<void>,
    private readonly onError: (error: Error) => void = () => {},
  ) {}

  /** Feed one stdin chunk into the frame decoder. */
  public feed(chunk: Buffer | string): void {
    let bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    if (this.discardBytesRemaining > 0) {
      const discarded = Math.min(bytes.length, this.discardBytesRemaining);
      this.discardBytesRemaining -= discarded;
      bytes = bytes.subarray(discarded);
      if (bytes.length === 0) return;
    }
    this.buffer = Buffer.concat([this.buffer, bytes]);

    while (true) {
      if (this.expectedBodyBytes !== undefined) {
        if (this.buffer.length < this.expectedBodyBytes) return;
        const body = this.buffer
          .subarray(0, this.expectedBodyBytes)
          .toString("utf8");
        this.buffer = this.buffer.subarray(this.expectedBodyBytes);
        this.expectedBodyBytes = undefined;
        this.dispatchBody(body);
        continue;
      }
      const headerIndex = this.buffer.indexOf("\r\n\r\n");
      if (headerIndex === -1) {
        if (this.buffer.length > MAX_LSP_HEADER_BYTES) {
          this.report(new Error("LSP header exceeds the 8 KiB limit."));
          this.buffer = Buffer.alloc(0);
        }
        return;
      }
      if (headerIndex > MAX_LSP_HEADER_BYTES) {
        this.report(new Error("LSP header exceeds the 8 KiB limit."));
        this.buffer = this.buffer.subarray(headerIndex + 4);
        continue;
      }

      const header = this.buffer.subarray(0, headerIndex).toString("ascii");
      const matches = [...header.matchAll(/^Content-Length:\s*(\d+)\s*$/gim)];
      if (matches.length !== 1) {
        this.report(
          new Error("LSP frame requires exactly one Content-Length header."),
        );
        this.buffer = this.buffer.subarray(headerIndex + 4);
        continue;
      }
      const contentLength = Number(matches[0][1]);
      const bodyStart = headerIndex + 4;
      this.buffer = this.buffer.subarray(bodyStart);

      if (!Number.isSafeInteger(contentLength)) {
        this.report(new Error("LSP Content-Length is invalid."));
        this.buffer = Buffer.alloc(0);
        return;
      }
      if (contentLength > MAX_LSP_BODY_BYTES) {
        const discarded = Math.min(this.buffer.length, contentLength);
        this.buffer = this.buffer.subarray(discarded);
        this.discardBytesRemaining = contentLength - discarded;
        this.report(new Error("LSP message exceeds the 8 MiB limit."));
        if (this.discardBytesRemaining > 0) return;
        continue;
      }
      this.expectedBodyBytes = contentLength;
    }
  }

  private dispatchBody(body: string): void {
    try {
      const message = JSONRPCMessageSchema.parse(JSON.parse(body) as unknown);
      Promise.resolve(this.onMessage(message)).catch((error: unknown) => {
        this.report(toError(error));
      });
    } catch (error: unknown) {
      this.report(
        new Error(`Invalid LSP JSON-RPC message: ${safeError(error)}`),
      );
    }
  }

  private report(error: Error): void {
    try {
      this.onError(error);
    } catch {
      // Error reporting must never break the protocol decoder.
    }
  }
}

function sendRPC(message: unknown): void {
  const body = JSON.stringify(message);
  process.stdout.write(
    `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`,
  );
}

function sendError(
  id: JSONRPCMessage["id"],
  code: number,
  message: string,
): void {
  if (id === undefined) return;
  sendRPC({ jsonrpc: "2.0", id, error: { code, message } });
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(message)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 1_000);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function getPrefixSuffix(
  text: string,
  line: number,
  character: number,
): { prefix: string; suffix: string } {
  const lines = text.split(/\r?\n/);
  if (line < 0 || line >= lines.length) {
    return { prefix: text, suffix: "" };
  }

  const beforeLines = lines.slice(0, line);
  const currentLine = lines[line];
  const charIdx = Math.min(character, currentLine.length);
  const prefix = [...beforeLines, currentLine.substring(0, charIdx)].join("\n");
  const suffix = [
    currentLine.substring(charIdx),
    ...lines.slice(line + 1),
  ].join("\n");
  return { prefix, suffix };
}

/** Run the stdio LSP bridge until the client exits or closes stdin. */
export async function runLSPServer(cwd: string): Promise<void> {
  console.error("[LSP] Starting Orbit LSP Server...");

  const config = ConfigLoader.loadSync(cwd);
  const version = readCliVersion();
  const autocompleteEngine = new AutocompleteEngine(cwd);
  const documentCache = new Map<string, string>();
  let shutdownRequested = false;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      autocompleteEngine.dispose();
      documentCache.clear();
      resolve();
    };

    const handleMessage = async (message: JSONRPCMessage): Promise<void> => {
      try {
        if (shutdownRequested && message.method !== "exit") {
          sendError(message.id, -32600, "Server has already shut down.");
          return;
        }
        switch (message.method) {
          case "initialize":
            sendRPC({
              jsonrpc: "2.0",
              id: message.id,
              result: {
                capabilities: {
                  textDocumentSync: 1,
                  completionProvider: {
                    resolveProvider: false,
                    triggerCharacters: [".", "(", "{", " ", ":", ","],
                  },
                },
                serverInfo: { name: "Orbit", version },
              },
            });
            break;
          case "initialized":
            console.error("[LSP] Orbit Autocomplete Server fully initialized.");
            break;
          case "textDocument/didOpen": {
            const params = DidOpenParamsSchema.parse(message.params);
            documentCache.set(
              params.textDocument.uri,
              params.textDocument.text,
            );
            break;
          }
          case "textDocument/didChange": {
            const params = DidChangeParamsSchema.parse(message.params);
            documentCache.set(
              params.textDocument.uri,
              params.contentChanges.at(-1)?.text || "",
            );
            break;
          }
          case "textDocument/didClose": {
            const params = DidCloseParamsSchema.parse(message.params);
            documentCache.delete(params.textDocument.uri);
            break;
          }
          case "textDocument/completion": {
            const params = CompletionParamsSchema.parse(message.params);
            const documentText = documentCache.get(params.textDocument.uri);
            if (!documentText) {
              sendRPC({ jsonrpc: "2.0", id: message.id, result: [] });
              break;
            }
            const { prefix, suffix } = getPrefixSuffix(
              documentText,
              params.position.line,
              params.position.character,
            );
            const completion = await autocompleteEngine.autocomplete(
              prefix,
              suffix,
              config,
              params.textDocument.uri,
            );
            const trimmed = completion.trim();
            sendRPC({
              jsonrpc: "2.0",
              id: message.id,
              result: trimmed
                ? [
                  {
                    label: trimmed.substring(0, 40)
                      + (trimmed.length > 40 ? "..." : ""),
                    kind: 15,
                    insertText: completion,
                    detail: "Orbit Autocomplete",
                    documentation: {
                      kind: "markdown",
                      value: `\`\`\`typescript\n${completion}\n\`\`\``,
                    },
                  },
                ]
                : [],
            });
            break;
          }
          case "shutdown":
            shutdownRequested = true;
            sendRPC({ jsonrpc: "2.0", id: message.id, result: null });
            break;
          case "exit":
            finish();
            break;
          default:
            sendError(
              message.id,
              -32601,
              `Method not found: ${message.method}`,
            );
        }
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          sendError(message.id, -32602, "Invalid method parameters.");
          return;
        }
        console.error(`[LSP Error] ${safeError(error)}`);
        sendError(message.id, -32603, "Internal Orbit LSP error.");
      }
    };

    const reader = new JSONRPCReader(handleMessage, (error) => {
      console.error(`[LSP Protocol Error] ${safeError(error)}`);
    });
    const onData = (chunk: Buffer | string) => reader.feed(chunk);
    const onEnd = () => {
      console.error("[LSP] Connection ended.");
      finish();
    };
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
  });
}
