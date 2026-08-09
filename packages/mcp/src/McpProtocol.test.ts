import { describe, expect, it } from "vitest";
import {
  compileMirroredToolParameters,
  createMirroredToolHeaders,
  createModernHttpHeaders,
  createModernRequestParams,
  encodeMcpHeaderValue,
  selectModernProtocolVersion,
} from "./McpProtocol.js";

describe("McpProtocol", () => {
  it("selects only mutually supported modern revisions", () => {
    expect(selectModernProtocolVersion(["2025-11-25", "2026-07-28"])).toBe(
      "2026-07-28",
    );
    expect(selectModernProtocolVersion(["2025-11-25"])).toBeUndefined();
  });

  it("adds required per-request metadata without discarding caller metadata", () => {
    expect(
      createModernRequestParams(
        { _meta: { progressToken: "progress-1" }, name: "status" },
        "2026-07-28",
        "0.5.0",
      ),
    ).toMatchObject({
      name: "status",
      _meta: {
        progressToken: "progress-1",
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": {
          name: "orbit-client",
          version: "0.5.0",
        },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    });
  });

  it("mirrors safe method/name headers and encodes unsafe values", () => {
    expect(
      createModernHttpHeaders(
        "resources/read",
        { uri: "file:///项目/结果.json" },
        "2026-07-28",
      ),
    ).toEqual({
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "resources/read",
      "Mcp-Name": encodeMcpHeaderValue("file:///项目/结果.json"),
    });
    expect(encodeMcpHeaderValue("plain-name")).toBe("plain-name");
    expect(encodeMcpHeaderValue(" padded ")).toMatch(/^=\?base64\?.+\?=$/);
  });

  it("validates and extracts x-mcp-header annotations", () => {
    const parameters = compileMirroredToolParameters({
      type: "object",
      properties: {
        region: { type: "string", "x-mcp-header": "Region" },
        options: {
          type: "object",
          properties: {
            dryRun: { type: "boolean", "x-mcp-header": "Dry-Run" },
            confidence: { type: "number", "x-mcp-header": "Confidence" },
          },
        },
      },
    });
    expect(
      createMirroredToolHeaders(parameters, {
        region: "华北",
        options: { dryRun: true, confidence: 0.875 },
      }),
    ).toEqual({
      "Mcp-Param-Region": encodeMcpHeaderValue("华北"),
      "Mcp-Param-Dry-Run": "true",
      "Mcp-Param-Confidence": "0.875",
    });
  });

  it("rejects ambiguous or unreachable x-mcp-header annotations", () => {
    expect(() =>
      compileMirroredToolParameters({
        type: "object",
        oneOf: [
          {
            type: "string",
            "x-mcp-header": "Unsafe",
          },
        ],
      }),
    ).toThrow("invalid x-mcp-header");
    expect(() =>
      compileMirroredToolParameters({
        type: "object",
        properties: {
          first: { type: "string", "x-mcp-header": "Tenant" },
          second: { type: "string", "x-mcp-header": "tenant" },
        },
      }),
    ).toThrow("duplicate x-mcp-header");
  });
});
