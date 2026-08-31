import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  ConfigSchema,
  applyPermissionModePreset,
} from "@orbit-build/config";
import {
  buildLifecycleHookEnvironment,
  matchesLifecycleHook,
  resolveLifecycleHookSandboxMode,
  selectLifecycleHooks,
} from "./LifecycleHooks.js";

describe("LifecycleHooks", () => {
  it("keeps extension isolation independent from unrestricted Full Access", () => {
    const config = ConfigSchema.parse({});
    applyPermissionModePreset(config, "auto");

    expect(resolveLifecycleHookSandboxMode(undefined, config)).toBe("off");
    expect(
      resolveLifecycleHookSandboxMode(
        { id: "trusted-extension", root: process.cwd() },
        config,
      ),
    ).toBe("required");
  });

  it("selects typed hooks by a safe glob matcher", () => {
    const config = ConfigSchema.parse({
      ...DEFAULT_CONFIG,
      hooks: {
        lifecycle: {
          preToolUse: [
            { command: "node validate.mjs", matcher: "write_*" },
            { command: "node ignore.mjs", matcher: "bash" },
          ],
        },
      },
    });
    const selected = selectLifecycleHooks(config.hooks, "preToolUse", {
      sessionId: "session-1",
      toolName: "write_file",
    });
    expect(selected.map((hook) => hook.command)).toEqual(["node validate.mjs"]);
    expect(
      matchesLifecycleHook("write_?ile", "preToolUse", {
        sessionId: "session-1",
        toolName: "write_file",
      }),
    ).toBe(true);
  });

  it("keeps legacy edit hooks blocking and scoped to write tools", () => {
    const hooks = {
      preEdit: "node legacy-pre.mjs",
      postEdit: "node legacy-post.mjs",
    };
    expect(
      selectLifecycleHooks(hooks, "preToolUse", {
        sessionId: "session-1",
        toolName: "edit_file",
        filePath: "src/index.ts",
      }),
    ).toMatchObject([
      { command: "node legacy-pre.mjs", onFailure: "block", legacy: true },
    ]);
    expect(
      selectLifecycleHooks(hooks, "preToolUse", {
        sessionId: "session-1",
        toolName: "bash",
      }),
    ).toEqual([]);
  });

  it("exports bounded redacted metadata without raw prompts or arguments", () => {
    const environment = buildLifecycleHookEnvironment("promptSubmit", {
      sessionId: "session-1",
      promptLength: 42,
      status: "API_KEY=secret-value",
    });
    expect(environment.ORBIT_HOOK_EVENT).toBe("promptSubmit");
    expect(environment.ORBIT_HOOK_PAYLOAD).toContain("promptLength");
    expect(environment.ORBIT_HOOK_PAYLOAD).not.toContain("secret-value");
  });
});
