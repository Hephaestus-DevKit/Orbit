import { describe, expect, it } from "vitest";
import { createCliRunOverrides } from "./CliRunOverrides.js";

describe("createCliRunOverrides", () => {
  it("keeps provider, model, and direct overrides together", () => {
    expect(
      createCliRunOverrides({
        provider: "tokendance",
        model: "deepseek-flash",
        direct: true,
      }),
    ).toEqual({
      provider: { default: "tokendance" },
      models: { default: "deepseek-flash" },
      direct: true,
    });
  });

  it("applies the complete unrestricted Full Access preset", () => {
    expect(createCliRunOverrides({ fullAccess: true })).toEqual({
      permissions: {
        mode: "auto",
        allowRead: true,
        requireApprovalForWrite: false,
        requireApprovalForBash: false,
        blockDangerousCommands: false,
        protectSecrets: false,
      },
    });
  });
});
