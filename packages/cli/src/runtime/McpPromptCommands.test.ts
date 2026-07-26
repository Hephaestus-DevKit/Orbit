import { describe, expect, it } from "vitest";
import {
  buildMcpPromptCommandCandidates,
  findMcpPromptCommand,
  mcpPromptCommandName,
  parseMcpPromptArguments,
} from "./McpPromptCommands.js";

const descriptors = [
  {
    serverName: "docs",
    prompt: {
      name: "search",
      description: "Search the docs",
      arguments: [
        { name: "query", description: "", required: true },
        { name: "limit", description: "", required: false },
      ],
    },
  },
];

describe("McpPromptCommands", () => {
  it("builds and resolves stable command tokens", () => {
    expect(mcpPromptCommandName("docs", "search")).toBe("mcp__docs__search");
    expect(findMcpPromptCommand("mcp__docs__search", descriptors)).toBe(
      descriptors[0],
    );
    expect(
      findMcpPromptCommand("mcp__docs__other", descriptors),
    ).toBeUndefined();
  });

  it("binds key=value tokens to declared arguments", () => {
    expect(
      parseMcpPromptArguments(
        "query=auth limit=5",
        descriptors[0].prompt.arguments,
      ),
    ).toEqual({ query: "auth", limit: "5" });
    expect(
      parseMcpPromptArguments(
        'query="auth tokens"',
        descriptors[0].prompt.arguments,
      ),
    ).toEqual({ query: "auth tokens" });
  });

  it("assigns free text to the first unset declared argument", () => {
    expect(
      parseMcpPromptArguments("auth tokens", descriptors[0].prompt.arguments),
    ).toEqual({ query: "auth tokens" });
    expect(
      parseMcpPromptArguments("limit=3 auth", descriptors[0].prompt.arguments),
    ).toEqual({ limit: "3", query: "auth" });
    expect(parseMcpPromptArguments("anything", [])).toEqual({});
    expect(
      parseMcpPromptArguments("", descriptors[0].prompt.arguments),
    ).toEqual({});
  });

  it("produces autocomplete candidates with argument hints", () => {
    expect(buildMcpPromptCommandCandidates(descriptors)).toEqual([
      {
        command: "/mcp__docs__search",
        description: "Search the docs",
        argumentHint: "<query> [limit]",
      },
    ]);
  });
});
