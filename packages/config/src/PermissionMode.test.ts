import { describe, expect, it } from "vitest";
import { ConfigSchema } from "./schema.js";
import { applyManagedPolicy, ManagedPolicySchema } from "./ManagedPolicy.js";
import {
  applyPermissionModePreset,
  createPermissionModeOverride,
  isFullAccessEnabled,
} from "./PermissionMode.js";

describe("permission mode presets", () => {
  it("enables unrestricted Full Access atomically", () => {
    const config = ConfigSchema.parse({});
    config.permissions.allowRead = false;

    expect(applyPermissionModePreset(config, "auto")).toEqual({ ok: true });
    expect(config.permissions).toMatchObject({
      mode: "auto",
      allowRead: true,
      requireApprovalForWrite: false,
      requireApprovalForBash: false,
      blockDangerousCommands: false,
      protectSecrets: false,
    });
    expect(isFullAccessEnabled(config)).toBe(true);
    expect(createPermissionModeOverride("auto").permissions).toMatchObject({
      mode: "auto",
      allowRead: true,
      requireApprovalForWrite: false,
      requireApprovalForBash: false,
      blockDangerousCommands: false,
      protectSecrets: false,
    });
  });

  it("does not report a partial auto configuration as Full Access", () => {
    const config = ConfigSchema.parse({
      permissions: {
        mode: "auto",
        allowRead: false,
        requireApprovalForWrite: false,
        requireApprovalForBash: false,
      },
    });

    expect(isFullAccessEnabled(config)).toBe(false);
  });

  it("restores approval flags when leaving Full Access", () => {
    const config = ConfigSchema.parse({});
    applyPermissionModePreset(config, "auto");

    expect(applyPermissionModePreset(config, "normal")).toEqual({ ok: true });
    expect(config.permissions).toMatchObject({
      mode: "normal",
      requireApprovalForWrite: true,
      requireApprovalForBash: true,
      blockDangerousCommands: true,
      protectSecrets: true,
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
