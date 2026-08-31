import { isFullAccessEnabled } from "@orbit-build/config";
import {
  buildInheritedChildEnvironment,
  buildSanitizedChildEnvironment,
} from "@orbit-build/shared";
import type { ToolContext } from "../types.js";
import type {
  ProcessSandboxMode,
  ProcessSandboxNetwork,
} from "@orbit-build/sandbox";

/** Build the child environment promised by the active tool permission scope. */
export function buildToolChildEnvironment(
  ctx: Pick<ToolContext, "config">,
): NodeJS.ProcessEnv {
  return ctx.config && isFullAccessEnabled(ctx.config)
    ? buildInheritedChildEnvironment()
    : buildSanitizedChildEnvironment();
}

export interface ToolProcessSandboxPolicy {
  mode: ProcessSandboxMode;
  network: ProcessSandboxNetwork;
  trustRoots?: Record<string, string>;
}

/** Full Access grants host authority; native isolation remains a separate normal-mode guard. */
export function buildToolProcessSandboxPolicy(
  ctx: Pick<ToolContext, "config">,
): ToolProcessSandboxPolicy {
  return {
    mode:
      ctx.config && isFullAccessEnabled(ctx.config)
        ? "off"
        : (ctx.config?.tools.bash.sandbox ?? "auto"),
    network: ctx.config?.tools.bash.network ?? "inherit",
    trustRoots: ctx.config?.security.windowsSandboxTrustRoots,
  };
}
