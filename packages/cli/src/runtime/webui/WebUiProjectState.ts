import { realpathSync } from "node:fs";
import { redactSecrets } from "@orbit-build/shared";
import type { WebUiOptions } from "./WebUiContracts.js";
import { projectPathKey } from "./WebUiNavigationRows.js";

type Entry = ReturnType<NonNullable<WebUiOptions["getProjects"]>>[number];

function currentProject(cwd: string, entries: Entry[]) {
  const match = (path: string) =>
    entries.find(item => projectPathKey(item.path) === projectPathKey(path));
  const exact = match(cwd);
  if (exact || !entries.length) return exact;
  try {
    return match(realpathSync.native(cwd));
  } catch {
    return undefined;
  }
}

/** Resolve registry identity before redacting display paths, including symlinked workspaces. */
export function projectSnapshot(cwd: string, entries: Entry[]) {
  const active = currentProject(cwd, entries);
  return {
    workspaceProjectId: active?.id,
    projectArchivedAt: active?.archivedAt,
    projects: entries.filter(project => project && typeof project.path === "string").slice(0, 200)
      .map(project => ({
        id: String(project.id || "").slice(0, 64),
        path: redactSecrets(project.path).slice(0, 4096),
        name: redactSecrets(project.name || "Orbit").slice(0, 200),
        lastOpenedAt: typeof project.lastOpenedAt === "string"
          ? project.lastOpenedAt.slice(0, 64)
          : "",
        available: project.available === true,
        ...(project.archivedAt ? { archivedAt: project.archivedAt } : {}),
      })),
  };
}

const chatMutations = new Set([
  "/api/chat",
  "/api/task",
  "/api/session",
  "/api/input-queue",
  "/api/review",
  "/api/agent",
  "/api/attachment",
  "/api/browser/open",
]);

/** Enforce the inherited archive on writes from all WebUI tabs, including stale clients. */
export function archiveBlocksRequest(
  method: string | undefined,
  path: string,
  options: WebUiOptions,
) {
  return method === "POST" && chatMutations.has(path)
    && Boolean(currentProject(options.cwd, options.getProjects?.() ?? [])?.archivedAt);
}
