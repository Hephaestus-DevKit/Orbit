import { describe, expect, it } from "../../../../scripts/testing/support.mjs";
import { ProviderSseParser } from "./ProviderSseParser.js";

describe("provider SSE framing", () => {
  it("preserves multiline data, comments, event names and CRLF across every read boundary", () => {
    const wire =
      '\uFEFF: keep-alive\r\nevent: message\r\ndata: {"answer":\r\ndata: "你好"}\r\n\r\ndata: [DONE]\r\n\r\n';
    for (let split = 0; split <= wire.length; split++) {
      const parser = new ProviderSseParser();
      expect([
        ...parser.feed(wire.slice(0, split)),
        ...parser.feed(wire.slice(split)),
      ]).toEqual([
        { event: "message", data: '{"answer":\n"你好"}' },
        { data: "[DONE]" },
      ]);
    }
  });
  it("ignores an unterminated terminal tail and dispatches only at a blank line", () => {
    const parser = new ProviderSseParser();
    expect(parser.feed('data: {"type":"message_stop"}\n')).toEqual([]);
    expect(parser.feed("\n")).toEqual([{ data: '{"type":"message_stop"}' }]);
    expect(parser.feed("data: [DONE]")).toEqual([]);
  });
  it("accepts lone CR, strips exactly one leading space and resets event names", () => {
    const parser = new ProviderSseParser();
    expect(parser.feed("event: first\rdata:  spaced\r\rdata\r\r")).toEqual([
      { event: "first", data: " spaced" },
      { data: "" },
    ]);
  });
  it("bounds each frame rather than rejecting a chunk containing many small frames", () => {
    const parser = new ProviderSseParser(12, 100);
    expect(parser.feed("data: a\n\ndata: b\n\ndata: c\n\n")).toHaveLength(3);
    expect(() => parser.feed("data: oversize")).toThrow("frame");
  });
  it("bounds total traffic including ignored comments", () => {
    const parser = new ProviderSseParser(50, 20);
    expect(parser.feed(": ping\n\n: ping\n\n")).toEqual([]);
    expect(() => parser.feed(": ping\n\n")).toThrow("total");
  });
});
