import { isFullAccessEnabled } from "@orbit-build/config";
import {
  buildInheritedChildEnvironment,
  buildSanitizedChildEnvironment,
} from "@orbit-build/shared";
import type { ToolContext } from "../types.js";

/** Build the child environment promised by the active tool permission scope. */
export function buildToolChildEnvironment(
  ctx: Pick<ToolContext, "config">,
): NodeJS.ProcessEnv {
  return ctx.config && isFullAccessEnabled(ctx.config)
    ? buildInheritedChildEnvironment()
    : buildSanitizedChildEnvironment();
}
