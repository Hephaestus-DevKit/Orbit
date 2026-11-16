import { describe, expect, it } from "vitest";
import {
  parseTextToolCalls,
  parseXMLToolCalls,
  generateXMLToolsPrompt,
  unwrapToolInputSchema,
  promptToolInput,
} from "./AgentToolProtocol.js";
import { z } from "zod";

it("repairs typed arguments and propagates interactive cancellation", async () => {
  const schema = z.object({
    enabled: z.boolean().prefault(false),
    mode: z.enum({ one: 1, two: 2 }),
    count: z.number().optional(),
  });
  const values = ["true", "2"];
  const repaired = await promptToolInput(schema, "{}", {
    askSelect: async () => values.shift() ?? null,
    askText: async () => "3",
  });
  expect(JSON.parse(repaired!)).toEqual({ enabled: true, mode: 2, count: 3 });
  expect(
    await promptToolInput(schema, "{}", {
      askSelect: async () => null,
      askText: async () => null,
    }),
  ).toBeNull();
});

it("renders refined and transformed Zod 4 inputs with their default optionality", () => {
  const count = z.string().transform(Number);
  expect(unwrapToolInputSchema(count)).toBeInstanceOf(z.ZodString);
  const prompt = generateXMLToolsPrompt([
    {
      name: "fixture",
      description: "input",
      inputSchema: z
        .object({ mode: z.enum(["auto", "fast"]).prefault("auto"), count })
        .refine(() => true),
    },
  ]);
  expect(prompt).toContain("type: enum, optional, values: auto, fast");
  expect(prompt).toContain("`count`: (type: string)");
});

const knownTools = new Set(["grep", "read_file", "edit_file", "bash"]);
const isKnown = (name: string) => knownTools.has(name);

describe("parseTextToolCalls", () => {
  it("parses Hermes-style bare tool_call tags with JSON bodies", () => {
    const calls = parseTextToolCalls(
      'I will search now.\n<tool_call>\n{"name": "grep", "arguments": {"pattern": "TODO"}}\n</tool_call>',
      isKnown,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("grep");
    expect(JSON.parse(calls[0].arguments)).toEqual({ pattern: "TODO" });
  });

  it("parses fenced json blocks shaped like tool calls", () => {
    const calls = parseTextToolCalls(
      'Let me read the file:\n```json\n{"tool": "read_file", "parameters": {"path": "src/app.ts"}}\n```\n',
      isKnown,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("read_file");
    expect(JSON.parse(calls[0].arguments)).toEqual({ path: "src/app.ts" });
  });

  it("accepts arrays of tool calls", () => {
    const calls = parseTextToolCalls(
      '<tool_call>[{"name": "grep", "arguments": {"pattern": "a"}}, {"name": "read_file", "arguments": {"path": "b.ts"}}]</tool_call>',
      isKnown,
    );

    expect(calls.map((call) => call.name)).toEqual(["grep", "read_file"]);
  });

  it("keeps pre-stringified argument payloads verbatim", () => {
    const calls = parseTextToolCalls(
      '<tool_call>{"name": "bash", "arguments": "{\\"command\\": \\"ls\\"}"}</tool_call>',
      isKnown,
    );

    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].arguments)).toEqual({ command: "ls" });
  });

  it("rejects candidates whose name is not a registered tool", () => {
    const calls = parseTextToolCalls(
      '```json\n{"name": "delete_everything", "arguments": {}}\n```',
      isKnown,
    );

    expect(calls).toHaveLength(0);
  });

  it("ignores ordinary json examples without a tool shape", () => {
    const calls = parseTextToolCalls(
      'Here is the config format:\n```json\n{"port": 3000, "host": "localhost"}\n```',
      isKnown,
    );

    expect(calls).toHaveLength(0);
  });

  it("ignores fenced blocks that are not valid JSON", () => {
    const calls = parseTextToolCalls(
      "```json\n{not valid json}\n```\n<tool_call>plain text</tool_call>",
      isKnown,
    );

    expect(calls).toHaveLength(0);
  });

  it("does not double-report Orbit XML-format calls", () => {
    const text =
      '<tool_call name="grep">\n  <pattern>TODO</pattern>\n</tool_call>';
    // The XML parser owns this format; the text parser must not match it.
    expect(parseXMLToolCalls(text)).toHaveLength(1);
    expect(parseTextToolCalls(text, isKnown)).toHaveLength(0);
  });
});
