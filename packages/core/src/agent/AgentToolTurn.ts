import { randomUUID } from "node:crypto";
import type { OrbitContentBlock, OrbitMessage, OrbitToolCall } from "@orbit-build/model-providers";

/** Persist each tool result and close interrupted exchanges without replaying tools. */
export class AgentToolTurn {
  private readonly results = new Map<string, OrbitContentBlock>();
  private message?: OrbitMessage;

  constructor(
    private readonly calls: readonly OrbitToolCall[],
    private readonly history: OrbitMessage[],
    private readonly persist: () => void,
  ) {}

  /** Save completed results immediately, in the original call order. */
  public record(...blocks: OrbitContentBlock[]): void {
    for (const block of blocks) {
      if (block.type !== "tool_result")
        throw new Error("Expected tool result.");
      const id = block.toolResult.toolCallId;
      if (!this.calls.some((call) => call.id === id))
        throw new Error("Tool result has no call in the current turn.");
      if (this.results.has(id)) continue;
      this.results.set(id, block);
    }
    if (this.results.size === 0) return;
    if (!this.message) {
      this.message = {
        id: `msg_tool_${randomUUID()}`,
        role: "tool",
        createdAt: new Date().toISOString(),
        content: [],
      };
      this.history.push(this.message);
    }
    this.message.content = this.calls.flatMap((call) => {
      const result = this.results.get(call.id);
      return result ? [result] : [];
    });
    this.persist();
  }

  /** Close every remaining call on cancellation or failure, never implying success. */
  public close(): void {
    const missing = this.calls.filter((call) => !this.results.has(call.id));
    if (missing.length === 0) return;
    this.record(
      ...missing.map((call): OrbitContentBlock => ({
        type: "tool_result",
        toolResult: {
          toolCallId: call.id,
          name: call.name,
          isError: true,
          content:
            "Execution stopped before a result was recorded. This tool was not replayed. Its outcome may be unknown; inspect the current state before retrying.",
        },
      })),
    );
  }
}
