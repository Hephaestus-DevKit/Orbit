import { spawn } from "child_process";
import { existsSync, mkdirSync, realpathSync, statSync } from "fs";
import { dirname, isAbsolute, parse, resolve } from "path";
import type { WebUiProjectAction } from "./webui/WebUiContracts.js";
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

/** Validate a requested project directory and launch an isolated Orbit WebUI. */
export async function launchOrbitProject(
  request: Extract<WebUiProjectAction, { action: "open" | "create" }>,
  options: ProjectLaunchOptions = {},
): Promise<ProjectLaunchResult> {
  if (!isAbsolute(request.path)) {
    throw new Error("Enter an absolute project folder path.");
  }
  const requestedPath = resolve(request.path);
  if (requestedPath === parse(requestedPath).root) {
    throw new Error("A filesystem root cannot be opened as an Orbit project.");
  }
  const entryPoint = options.entryPoint || process.argv[1];
  if (!entryPoint) throw new Error("Orbit CLI entry point is unavailable.");
  if (request.action === "create") {
    createProjectDirectory(requestedPath);
  } else {
    requireProjectDirectory(requestedPath);
  }

  const projectPath = realpathSync(requestedPath);
  const launch = options.launch || spawn;
  const child = launch(
    options.executable || process.execPath,
    [entryPoint, "webui", "--cwd", projectPath],
    {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      cwd: projectPath,
      detached: true,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
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
          new Error(`Orbit project could not be opened: ${error.message}`),
        );
      const onExit = (code: number | null) =>
        finish(
          undefined,
          new Error(
            `Orbit project exited before its Web UI was ready${code === null ? "." : ` (code ${code}).`}`,
          ),
        );
      const timeout = setTimeout(
        () => {
          child.kill();
          finish(
            undefined,
            new Error("Timed out while starting the Orbit project."),
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

function createProjectDirectory(projectPath: string): void {
  if (existsSync(projectPath)) {
    throw new Error("Project folder already exists. Use Open folder instead.");
  }
  const parentPath = dirname(projectPath);
  if (!existsSync(parentPath)) {
    throw new Error(
      "The parent folder does not exist. Choose an existing location first.",
    );
  }
  if (!statSync(parentPath).isDirectory()) {
    throw new Error("The project parent path must be a directory.");
  }
  try {
    mkdirSync(projectPath);
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw new Error(
        "Project folder already exists. Use Open folder instead.",
      );
    }
    throw new Error("Orbit could not create the project folder.", {
      cause: error,
    });
  }
}

function requireProjectDirectory(projectPath: string): void {
  if (!existsSync(projectPath)) {
    throw new Error("Project folder does not exist.");
  }
  if (!statSync(projectPath).isDirectory()) {
    throw new Error("Project path must point to a directory.");
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
