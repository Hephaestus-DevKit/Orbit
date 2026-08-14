import { spawn } from "child_process";
import { existsSync, mkdirSync, realpathSync, statSync } from "fs";
import { dirname, isAbsolute, parse, resolve } from "path";
import type {
  WebUiProjectAction,
  WebUiProjectErrorCode,
} from "./webui/WebUiContracts.js";
import { HIDDEN_CHILD_PROCESS_OPTIONS } from "@orbit-build/shared";
import { sanitizeLocalWebUiUrl } from "./webui/WebUiSecurity.js";

export interface ProjectLaunchOptions {
  entryPoint?: string;
  executable?: string;
  launch?: typeof spawn;
  startupTimeoutMs?: number;
}

export const PROJECT_WEB_UI_READY_MESSAGE = "orbit-webui-ready";

export interface ProjectLaunchResult {
  path: string;
  url: string;
}

/** A bounded, machine-readable project launch failure. */
export class ProjectLaunchError extends Error {
  public readonly name = "ProjectLaunchError";

  public constructor(
    public readonly code: WebUiProjectErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** Validate a requested project directory and launch an isolated Orbit WebUI. */
export async function launchOrbitProject(
  request: Extract<WebUiProjectAction, { action: "open" | "create" }>,
  options: ProjectLaunchOptions = {},
): Promise<ProjectLaunchResult> {
  if (!isAbsolute(request.path)) {
    throw new ProjectLaunchError(
      "absolute_path_required",
      "Enter an absolute project folder path.",
    );
  }
  const requestedPath = resolve(request.path);
  rejectFilesystemRoot(requestedPath);
  const entryPoint = options.entryPoint || process.argv[1];
  if (!entryPoint) {
    throw new ProjectLaunchError(
      "entrypoint_unavailable",
      "Orbit CLI entry point is unavailable.",
    );
  }
  if (request.action === "create") {
    ensureProjectDirectory(requestedPath);
  } else {
    requireProjectDirectory(requestedPath);
  }

  const projectPath = realpathSync.native(requestedPath);
  rejectFilesystemRoot(projectPath);
  const launch = options.launch || spawn;
  let child: ReturnType<typeof spawn>;
  try {
    child = launch(
      options.executable || process.execPath,
      [entryPoint, "webui", "--cwd", projectPath],
      {
        ...HIDDEN_CHILD_PROCESS_OPTIONS,
        cwd: projectPath,
        detached: true,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
  } catch (error: unknown) {
    throw new ProjectLaunchError(
      "launch_failed",
      "Orbit project could not be started.",
      { cause: error },
    );
  }
  return await new Promise<ProjectLaunchResult>(
    (resolveLaunch, rejectLaunch) => {
      let settled = false;
      const finish = (
        result: ProjectLaunchResult | undefined,
        error?: Error,
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.removeListener("message", onMessage);
        child.removeListener("error", onError);
        child.removeListener("exit", onExit);
        if (child.connected) {
          try {
            child.disconnect();
          } catch {
            // The child may close its IPC channel while startup settles.
          }
        }
        child.unref();
        if (result) resolveLaunch(result);
        else
          rejectLaunch(
            error || new Error("Orbit Web UI could not be started."),
          );
      };
      const onMessage = (message: unknown) => {
        const url = parseReadyUrl(message);
        if (url) finish({ path: projectPath, url });
      };
      const onError = (error: Error) =>
        finish(
          undefined,
          new ProjectLaunchError(
            "launch_failed",
            `Orbit project could not be opened: ${error.message}`,
            { cause: error },
          ),
        );
      const onExit = (code: number | null) =>
        finish(
          undefined,
          new ProjectLaunchError(
            "startup_failed",
            `Orbit project exited before its Web UI was ready${code === null ? "." : ` (code ${code}).`}`,
          ),
        );
      const timeout = setTimeout(
        () => {
          child.kill();
          finish(
            undefined,
            new ProjectLaunchError(
              "startup_timeout",
              "Timed out while starting the Orbit project.",
            ),
          );
        },
        Math.max(1_000, options.startupTimeoutMs ?? 15_000),
      );
      timeout.unref();
      child.on("message", onMessage);
      child.once("error", onError);
      child.once("exit", onExit);
    },
  );
}

function parseReadyUrl(message: unknown): string | undefined {
  if (
    typeof message !== "object" ||
    message === null ||
    !("type" in message) ||
    !("url" in message) ||
    message.type !== PROJECT_WEB_UI_READY_MESSAGE ||
    typeof message.url !== "string"
  ) {
    return undefined;
  }
  return sanitizeLocalWebUiUrl(message.url);
}

function ensureProjectDirectory(projectPath: string): void {
  if (existsSync(projectPath)) {
    requireProjectDirectory(projectPath);
    return;
  }
  const parentPath = dirname(projectPath);
  if (!existsSync(parentPath)) {
    throw new ProjectLaunchError(
      "parent_missing",
      "The parent folder does not exist. Choose an existing location first.",
    );
  }
  if (!statSync(parentPath).isDirectory()) {
    throw new ProjectLaunchError(
      "parent_not_directory",
      "The project parent path must be a directory.",
    );
  }
  try {
    mkdirSync(projectPath);
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "EEXIST") {
      requireProjectDirectory(projectPath);
      return;
    }
    throw new ProjectLaunchError(
      "create_failed",
      "Orbit could not create the project folder.",
      { cause: error },
    );
  }
}

function requireProjectDirectory(projectPath: string): void {
  if (!existsSync(projectPath)) {
    throw new ProjectLaunchError(
      "project_missing",
      "Project folder does not exist.",
    );
  }
  if (!statSync(projectPath).isDirectory()) {
    throw new ProjectLaunchError(
      "project_not_directory",
      "Project path must point to a directory.",
    );
  }
}

function rejectFilesystemRoot(projectPath: string): void {
  const normalized = resolve(projectPath);
  if (normalized === parse(normalized).root) {
    throw new ProjectLaunchError(
      "filesystem_root",
      "A filesystem root cannot be opened as an Orbit project.",
    );
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
