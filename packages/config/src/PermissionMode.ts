import type { OrbitConfig } from "./schema.js";
import { validateManagedRuntimeChange } from "./ManagedPolicy.js";

export type PermissionMode = OrbitConfig["permissions"]["mode"];

export interface PermissionModePresetResult {
  ok: boolean;
  message?: string;
}

/**
 * Apply one coherent permission preset instead of leaving approval flags in a
 * stale state from the previously selected mode.
 */
export function applyPermissionModePreset(
  config: OrbitConfig,
  mode: PermissionMode,
): PermissionModePresetResult {
  const fullAccess = mode === "auto";
  const violation = validateManagedRuntimeChange(config, {
    permissionMode: mode,
    requireWriteApproval: !fullAccess,
    requireBashApproval: !fullAccess,
  });
  if (violation) return { ok: false, message: violation };

  config.permissions.mode = mode;
  config.permissions.allowRead = true;
  config.permissions.requireApprovalForWrite = !fullAccess;
  config.permissions.requireApprovalForBash = !fullAccess;
  config.permissions.blockDangerousCommands = !fullAccess;
  config.permissions.protectSecrets = !fullAccess;
  return { ok: true };
}

/** True only when Auto has its complete unrestricted Full Access preset. */
export function isFullAccessEnabled(config: OrbitConfig): boolean {
  return (
    config.permissions.mode === "auto" &&
    config.permissions.allowRead &&
    !config.permissions.requireApprovalForWrite &&
    !config.permissions.requireApprovalForBash &&
    !config.permissions.blockDangerousCommands &&
    !config.permissions.protectSecrets
  );
}

/** Nested CLI override used by explicit one-shot Full Access flags. */
export function createPermissionModeOverride(mode: PermissionMode): {
  permissions: {
    mode: PermissionMode;
    allowRead: true;
    requireApprovalForWrite: boolean;
    requireApprovalForBash: boolean;
    blockDangerousCommands: boolean;
    protectSecrets: boolean;
  };
} {
  const fullAccess = mode === "auto";
  return {
    permissions: {
      mode,
      allowRead: true,
      requireApprovalForWrite: !fullAccess,
      requireApprovalForBash: !fullAccess,
      blockDangerousCommands: !fullAccess,
      protectSecrets: !fullAccess,
    },
  };
}
