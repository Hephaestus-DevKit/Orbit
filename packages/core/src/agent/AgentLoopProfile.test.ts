import { describe, expect, it } from "vitest";
import { selectProfileMcpServers } from "./AgentLoop.js";
import { mergeLifecycleHooks } from "../index.js";

describe("AgentLoop profile runtime controls", () => {
  it("restricts MCP startup to the profile allow-list without mutating config", () => {
    const configured = {
      docs: { command: "docs" },
      git: { command: "git" },
    } as never;
    expect(selectProfileMcpServers(configured, ["git"])).toEqual({
      git: { command: "git" },
    });
    expect(configured).toEqual({
      docs: { command: "docs" },
      git: { command: "git" },
    });
    expect(selectProfileMcpServers(configured, undefined)).toBe(configured);
  });

  it("runs profile hooks before global hooks for deterministic policy layering", () => {
    const profile = {
      preToolUse: [{ command: "profile-check", onFailure: "block" }],
    } as never;
    const global = {
      preToolUse: [{ command: "global-check", onFailure: "warn" }],
      stop: [{ command: "global-stop", onFailure: "ignore" }],
    } as never;
    expect(mergeLifecycleHooks(profile, global)).toMatchObject({
      preToolUse: [
        { command: "profile-check", onFailure: "block" },
        { command: "global-check", onFailure: "warn" },
      ],
      stop: [{ command: "global-stop", onFailure: "ignore" }],
    });
  });
});
