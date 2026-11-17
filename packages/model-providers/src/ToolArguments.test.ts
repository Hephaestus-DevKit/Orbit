import { describe, expect, it } from "vitest";
import { validateCompleteToolCallBatch } from "./ToolArguments.js";

describe("complete tool-call batch", () => {
  it("accepts a valid settled parallel batch", () => {
    expect(() =>
      validateCompleteToolCallBatch([
        { id: "first", name: "read_file", arguments: "{}" },
        { id: "second", name: "list_files", arguments: '{"path":"."}' },
      ]),
    ).not.toThrow();
  });
  it.each([
    [{ id: "", name: "read_file", arguments: "{}" }],
    [{ id: "first", name: " ", arguments: "{}" }],
    [
      { id: "first", name: "read_file", arguments: "{}" },
      { id: "first", name: "read_file", arguments: "{}" },
    ],
    [
      { id: "first", name: "read_file", arguments: "{}" },
      { id: "second", name: "read_file", arguments: "[]" },
    ],
  ])("rejects the whole invalid batch", (...calls) => {
    expect(() => validateCompleteToolCallBatch(calls)).toThrow();
  });
});
