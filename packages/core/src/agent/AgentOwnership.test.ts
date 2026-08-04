import { describe, expect, it } from "vitest";
import {
  agentOwnershipScopesOverlap,
  normalizeAgentOwnershipScope,
} from "./AgentOwnership.js";

describe("agent ownership scopes", () => {
  it("normalizes workspace aliases and portable relative paths", () => {
    expect(normalizeAgentOwnershipScope("workspace")).toBe("*");
    expect(normalizeAgentOwnershipScope(".\\src\\core//")).toBe("src/core");
    expect(agentOwnershipScopesOverlap("src", "src/core")).toBe(true);
    expect(agentOwnershipScopesOverlap("docs", "src/core")).toBe(false);
    expect(agentOwnershipScopesOverlap("workspace", "docs")).toBe(true);
  });

  it.each([
    "",
    "../src",
    "src/../secrets",
    "/etc",
    "C:\\temp",
    "\\\\server\\share",
  ])("rejects unsafe or ambiguous scope %j", (scope) => {
    expect(() => normalizeAgentOwnershipScope(scope)).toThrow();
  });
});
