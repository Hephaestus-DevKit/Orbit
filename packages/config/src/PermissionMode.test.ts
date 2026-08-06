import { describe, expect, it } from "vitest";
import { ConfigSchema } from "./schema.js";
import { applyManagedPolicy, ManagedPolicySchema } from "./ManagedPolicy.js";
import {
  applyPermissionModePreset,
  createPermissionModeOverride,
  isFullAccessEnabled,
} from "./PermissionMode.js";

describe("permission mode presets", () => {
  it("enables guarded Full Access atomically", () => {
    const config = ConfigSchema.parse({});

    expect(applyPermissionModePreset(config, "auto")).toEqual({ ok: true });
    expect(config.permissions).toMatchObject({
      mode: "auto",
      requireApprovalForWrite: false,
      requireApprovalForBash: false,
      blockDangerousCommands: true,
      protectSecrets: true,
    });
    expect(isFullAccessEnabled(config)).toBe(true);
    expect(createPermissionModeOverride("auto").permissions).toMatchObject({
      mode: "auto",
      requireApprovalForWrite: false,
      requireApprovalForBash: false,
    });
  });

  it("restores approval flags when leaving Full Access", () => {
    const config = ConfigSchema.parse({});
    applyPermissionModePreset(config, "auto");

    expect(applyPermissionModePreset(config, "normal")).toEqual({ ok: true });
    expect(config.permissions).toMatchObject({
      mode: "normal",
      requireApprovalForWrite: true,
      requireApprovalForBash: true,
    });
    expect(isFullAccessEnabled(config)).toBe(false);
  });

  it("cannot bypass managed approval requirements", () => {
    const config = applyManagedPolicy(
      ConfigSchema.parse({}),
      ManagedPolicySchema.parse({
        schemaVersion: 1,
        requireWriteApproval: true,
        requireBashApproval: true,
      }),
    );

    expect(applyPermissionModePreset(config, "auto")).toMatchObject({
      ok: false,
      message: expect.stringContaining("write approval"),
    });
    expect(config.permissions.requireApprovalForWrite).toBe(true);
    expect(config.permissions.requireApprovalForBash).toBe(true);
  });
});
