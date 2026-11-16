import { describe, expect, it, vi } from "vitest";
import { JSONRPCReader } from "./LSPServer.js";

describe("JSONRPCReader", () => {
  it("frames UTF-8 JSON messages by byte length across split chunks", () => {
    const messages: unknown[] = [];
    const reader = new JSONRPCReader((message) => {
      messages.push(message);
    });
    const body = JSON.stringify({
      jsonrpc: "2.0",
      method: "测试/完成",
      params: { text: "你好，Orbit 🚀" },
    });
    const frame = Buffer.from(
      `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`,
      "utf8",
    );
    const splitAt = frame.indexOf(Buffer.from("你")) + 1;

    reader.feed(frame.subarray(0, splitAt));
    expect(messages).toEqual([]);
    reader.feed(frame.subarray(splitAt));

    expect(messages).toEqual([
      {
        jsonrpc: "2.0",
        method: "测试/完成",
        params: { text: "你好，Orbit 🚀" },
      },
    ]);
  });

  it("rejects malformed JSON-RPC input without calling the handler", () => {
    const onMessage = vi.fn();
    const onError = vi.fn();
    const reader = new JSONRPCReader(onMessage, onError);
    const body = JSON.stringify({ method: "initialize" });

    reader.feed(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);

    expect(onMessage).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0].message).toContain("Invalid LSP JSON-RPC");
  });

  it("rejects duplicate Content-Length headers", () => {
    const onMessage = vi.fn();
    const onError = vi.fn();
    const reader = new JSONRPCReader(onMessage, onError);

    reader.feed("Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}");

    expect(onMessage).not.toHaveBeenCalled();
    expect(onError.mock.calls[0][0].message).toContain("exactly one");
  });

  it("bounds incomplete protocol headers", () => {
    const onError = vi.fn();
    const reader = new JSONRPCReader(() => {}, onError);

    reader.feed("x".repeat(8 * 1024 + 1));

    expect(onError.mock.calls[0][0].message).toContain("8 KiB");
  });
});
