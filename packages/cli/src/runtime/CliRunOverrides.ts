import { createPermissionModeOverride } from "@orbit-build/config";

export interface CliRunOverrideOptions {
  provider?: string;
  model?: string;
  direct?: boolean;
  fullAccess?: boolean;
}

/** Build one coherent override object for every CLI entry point. */
export function createCliRunOverrides(
  options: CliRunOverrideOptions,
): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};

  if (options.provider) {
    overrides.provider = { default: options.provider };
  }
  if (options.model) {
    overrides.models = { default: options.model };
  }
  if (options.direct) {
    overrides.direct = true;
  }
  if (options.fullAccess) {
    overrides.permissions = createPermissionModeOverride("auto").permissions;
  }

  return overrides;
}
