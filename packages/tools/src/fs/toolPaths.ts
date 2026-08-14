import { isFullAccessEnabled } from "@orbit-build/config";
import { normalizePath, resolveSafePath } from "@orbit-build/shared";
import { isAbsolute, resolve } from "path";
import type { ToolContext } from "../types.js";

/** True when filesystem tools may use paths visible to the host account. */
export function hasFullHostAccess(ctx: ToolContext): boolean {
  return Boolean(ctx.config && isFullAccessEnabled(ctx.config));
}

/** Resolve a filesystem-tool path against its effective permission scope. */
export function resolveToolPath(
  ctx: ToolContext,
  requestedPath: string,
): string {
  if (!hasFullHostAccess(ctx)) return resolveSafePath(ctx.cwd, requestedPath);
  return normalizePath(
    isAbsolute(requestedPath)
      ? resolve(requestedPath)
      : resolve(ctx.cwd, requestedPath),
  );
}
